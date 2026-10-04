import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const state = vi.hoisted(() => ({
  invoke: vi.fn(),
  open: vi.fn(),
  save: vi.fn(),
  close: vi.fn(),
  closeRequested: null as ((event: { preventDefault: () => void }) => void) | null,
  drawings: new Map<string, string>(),
  recent: [] as string[],
  recovery: null as { updated_at: number; source_path: string | null; drawing: string } | null,
  modifiedAt: null as number | null,
}));

vi.mock("@excalidraw/excalidraw", async () => {
  const React = await import("react");
  return {
    Excalidraw: ({ initialData, onChange }: { initialData: { elements?: { id: string }[] }; onChange: (elements: { id: string }[], appState: object, files: object) => void }) => {
      const [elements, setElements] = React.useState(initialData.elements ?? []);
      return React.createElement(
        "div",
        { "aria-label": "Drawing canvas" },
        React.createElement("output", { "data-testid": "elements" }, elements.map(({ id }) => id).join(",")),
        React.createElement("button", {
          type: "button",
          onClick: () => {
            const next = [...elements, { id: "new-element" }];
            setElements(next);
            onChange(next, {}, {});
          },
        }, "Add element"),
      );
    },
    loadFromBlob: async (blob: Blob) => JSON.parse(await blob.text()),
    serializeAsJSON: (elements: unknown[], appState: object, files: object) => JSON.stringify({
      type: "excalidraw",
      version: 2,
      source: "unit-test",
      elements,
      appState,
      files,
    }),
  };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: state.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: state.open, save: state.save }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: (callback: typeof state.closeRequested) => {
      state.closeRequested = callback;
      return Promise.resolve(() => undefined);
    },
    close: state.close,
  }),
}));

function drawing(elements: { id: string }[]) {
  return JSON.stringify({
    type: "excalidraw",
    version: 2,
    source: "unit-test",
    elements,
    appState: {},
    files: {},
  });
}

async function openEditor() {
  render(<App />);
  await screen.findByText("Works offline");
}

describe("drawing file workflow", () => {
  beforeEach(() => {
    state.drawings.clear();
    state.recent = [];
    state.recovery = null;
    state.modifiedAt = null;
    state.closeRequested = null;
    state.open.mockResolvedValue(null);
    state.save.mockResolvedValue(null);
    state.close.mockResolvedValue(undefined);
    state.invoke.mockImplementation(async (command: string, args?: { path?: string; contents?: string; snapshot?: typeof state.recovery }) => {
      switch (command) {
        case "read_recent_files": return [...state.recent];
        case "read_recovery": return state.recovery;
        case "drawing_modified_at": return state.modifiedAt;
        case "read_drawing": {
          const contents = state.drawings.get(args?.path ?? "");
          if (contents === undefined) throw new Error("File not found");
          return contents;
        }
        case "write_drawing":
          state.drawings.set(args?.path ?? "", args?.contents ?? "");
          return undefined;
        case "remember_file":
          state.recent = [args?.path ?? "", ...state.recent.filter((item) => item !== args?.path)].slice(0, 8);
          return [...state.recent];
        case "write_recovery":
          state.recovery = args?.snapshot ?? null;
          return undefined;
        case "clear_recovery":
          state.recovery = null;
          return undefined;
        default: throw new Error(`Unexpected command: ${command}`);
      }
    });
  });

  afterEach(() => cleanup());

  it("saves a new blank drawing as valid Excalidraw JSON", async () => {
    state.save.mockResolvedValue("/drawings/blank.excalidraw");
    await openEditor();

    fireEvent.click(screen.getAllByRole("button", { name: /save/i })[0]);

    await waitFor(() => expect(state.drawings.has("/drawings/blank.excalidraw")).toBe(true));
    expect(JSON.parse(state.drawings.get("/drawings/blank.excalidraw") ?? "")).toMatchObject({
      type: "excalidraw",
      elements: [],
      appState: {},
      files: {},
    });
  });

  it("keeps the current drawing open when a malformed file is selected", async () => {
    state.drawings.set("/drawings/broken.excalidraw", "{ malformed");
    state.open.mockResolvedValue("/drawings/broken.excalidraw");
    await openEditor();

    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    await screen.findByText(/Could not open broken\.excalidraw/);
    expect(screen.getByTestId("elements").textContent).toBe("");
    expect(screen.getByText("Untitled drawing").textContent).toBe("Untitled drawing");
  });

  it("preserves existing elements and metadata when saving an opened drawing", async () => {
    const path = "/drawings/existing.excalidraw";
    const original = {
      ...JSON.parse(drawing([{ id: "existing-element" }])),
      appState: { viewBackgroundColor: "#fefefe" },
      files: { "image-id": { id: "image-id", dataURL: "data:image/png;base64,AA==", mimeType: "image/png", created: 1 } },
    };
    state.drawings.set(path, JSON.stringify(original));
    state.open.mockResolvedValue(path);
    await openEditor();

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(screen.getByText("existing.excalidraw")).toBeTruthy());
    fireEvent.click(screen.getAllByRole("button", { name: /save/i })[0]);

    await waitFor(() => expect(state.invoke).toHaveBeenCalledWith(
      "write_drawing",
      expect.objectContaining({ path, contents: expect.any(String) }),
    ));
    expect(JSON.parse(state.drawings.get(path) ?? "")).toMatchObject({
      type: "excalidraw",
      version: 2,
      elements: [{ id: "existing-element" }],
      appState: { viewBackgroundColor: "#fefefe" },
      files: { "image-id": { id: "image-id", dataURL: "data:image/png;base64,AA==" } },
    });
  });

  it("keeps unsaved changes when opening another drawing is cancelled", async () => {
    state.drawings.set("/drawings/other.excalidraw", drawing([{ id: "other-element" }]));
    state.open.mockResolvedValue("/drawings/other.excalidraw");
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Add element" }));
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await screen.findByRole("dialog", { name: "Save your changes?" });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("elements").textContent).toContain("new-element");
    expect(screen.getByText("Untitled drawing").textContent).toBe("Untitled drawing");
  });

  it("offers and restores an interrupted-session draft without saving it over the file", async () => {
    const draft = drawing([{ id: "recovered-element" }]);
    state.recovery = { updated_at: Date.now(), source_path: "/drawings/original.excalidraw", drawing: draft };
    state.drawings.set("/drawings/original.excalidraw", drawing([{ id: "saved-element" }]));
    state.modifiedAt = Date.now() - 10_000;
    await openEditor();

    await screen.findByRole("dialog", { name: "Restore your last session?" });
    fireEvent.click(screen.getByRole("button", { name: "Restore draft" }));

    await waitFor(() => expect(screen.getByTestId("elements").textContent).toContain("recovered-element"));
    expect(screen.getByText("Unsaved").textContent).toBe("Unsaved");
    expect(state.drawings.get("/drawings/original.excalidraw")).toContain("saved-element");
  });
});
