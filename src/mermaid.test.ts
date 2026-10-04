// @vitest-environment jsdom

import { beforeAll, describe, expect, it } from "vitest";
import { parseMermaidToExcalidraw } from "@excalidraw/mermaid-to-excalidraw";

beforeAll(() => {
  Object.defineProperty(globalThis, "CSSStyleSheet", {
    configurable: true,
    value: window.CSSStyleSheet,
  });
  Object.defineProperty(SVGElement.prototype, "getBBox", {
    configurable: true,
    value: () => ({ x: 0, y: 0, width: 100, height: 20 }),
  });
  Object.defineProperty(SVGElement.prototype, "getComputedTextLength", {
    configurable: true,
    value: () => 50,
  });
});

describe("Mermaid dependency overrides", () => {
  it("converts a flowchart through the patched parser and ID generator", async () => {
    const result = await parseMermaidToExcalidraw("graph TD; A-->B");

    expect(result.elements).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "A", type: "rectangle" }),
      expect.objectContaining({ id: "B", type: "rectangle" }),
      expect.objectContaining({ type: "arrow" }),
    ]));
  });
});
