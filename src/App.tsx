import { useCallback, useEffect, useRef, useState } from "react";
import { Excalidraw, loadFromBlob, serializeAsJSON } from "@excalidraw/excalidraw";
import type { ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  AlertCircle,
  ChevronDown,
  Clock3,
  FilePlus2,
  FolderOpen,
  PencilRuler,
  Save,
  X,
} from "lucide-react";

type RecoverySnapshot = {
  updated_at: number;
  source_path: string | null;
  drawing: string;
};

type FileAction =
  | { type: "new" }
  | { type: "open"; path: string; scene: ExcalidrawInitialDataState }
  | { type: "close" };

const drawingFilter = [{ name: "Excalidraw drawing", extensions: ["excalidraw"] }];
const defaultAppState = {
  gridSize: 20,
  gridStep: 5,
  gridModeEnabled: false,
  viewBackgroundColor: "#ffffff",
};

function fileName(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

function sceneJson(scene: ExcalidrawInitialDataState) {
  return serializeAsJSON(
    scene.elements ?? [],
    { ...defaultAppState, ...scene.appState },
    scene.files ?? {},
    "local",
  );
}

async function parseDrawing(contents: string) {
  return loadFromBlob(new Blob([contents], { type: "application/json" }), null, null);
}

const blankScene: ExcalidrawInitialDataState = { elements: [], appState: defaultAppState };
const blankDrawing = sceneJson(blankScene);

export default function App() {
  const [scene, setScene] = useState<ExcalidrawInitialDataState>(blankScene);
  const [sceneKey, setSceneKey] = useState(0);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [pendingAction, setPendingAction] = useState<FileAction | null>(null);
  const [recoverySnapshot, setRecoverySnapshot] = useState<RecoverySnapshot | null>(null);
  const [ready, setReady] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const savedJson = useRef(blankDrawing);
  const currentJson = useRef(blankDrawing);
  const currentPathRef = useRef<string | null>(null);
  const recoveryTimer = useRef<number | undefined>(undefined);
  const dirtyRef = useRef(false);
  const allowClose = useRef(false);

  const setPath = useCallback((path: string | null) => {
    currentPathRef.current = path;
    setCurrentPath(path);
  }, []);

  const showError = useCallback((error: unknown) => {
    setNotice(error instanceof Error ? error.message : String(error));
    window.setTimeout(() => setNotice(""), 5000);
  }, []);

  const scheduleRecovery = useCallback((drawing: string, sourcePath = currentPathRef.current) => {
    if (recoveryTimer.current) window.clearTimeout(recoveryTimer.current);
    recoveryTimer.current = window.setTimeout(() => {
      invoke("write_recovery", {
        snapshot: {
          updated_at: Date.now(),
          source_path: sourcePath,
          drawing,
        } satisfies RecoverySnapshot,
      }).catch(showError);
    }, 700);
  }, [showError]);

  const remember = useCallback(async (path: string) => {
    const files = await invoke<string[]>("remember_file", { path });
    setRecentFiles(files);
  }, []);

  const installScene = useCallback(
    async (nextScene: ExcalidrawInitialDataState, path: string | null, baseline?: string) => {
      const serialized = sceneJson(nextScene);
      setScene(nextScene);
      setSceneKey((value) => value + 1);
      setPath(path);
      if (recoveryTimer.current) window.clearTimeout(recoveryTimer.current);
      currentJson.current = serialized;
      savedJson.current = baseline ?? serialized;
      dirtyRef.current = baseline === undefined ? false : baseline !== serialized;
      setDirty(dirtyRef.current);
      setPendingAction(null);
      if (dirtyRef.current) {
        setNotice("Recovered changes are not saved to the drawing file yet.");
      } else {
        setNotice("");
      }
      await invoke("clear_recovery");
      if (dirtyRef.current) scheduleRecovery(currentJson.current, path);
      if (path) await remember(path);
    },
    [remember, scheduleRecovery, setPath],
  );

  const readScene = useCallback(async (path: string) => {
    const contents = await invoke<string>("read_drawing", { path });
    const parsed = await parseDrawing(contents);
    return { parsed, baseline: sceneJson(parsed) };
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([
      invoke<string[]>("read_recent_files"),
      invoke<RecoverySnapshot | null>("read_recovery"),
    ])
      .then(async ([files, recovery]) => {
        if (!active) return;
        setRecentFiles(files.filter((path) => path.toLowerCase().endsWith(".excalidraw")));
        if (recovery?.drawing) {
          if (recovery.source_path) {
            try {
              const modifiedAt = await invoke<number | null>("drawing_modified_at", { path: recovery.source_path });
              if (modifiedAt !== null && modifiedAt >= recovery.updated_at) {
                await invoke("clear_recovery");
              } else {
                setRecoverySnapshot(recovery);
              }
            } catch (error) {
              showError(error);
              setRecoverySnapshot(recovery);
            }
          } else {
            setRecoverySnapshot(recovery);
          }
        }
        if (active) setReady(true);
      })
      .catch((error) => {
        showError(error);
        setReady(true);
      });
    return () => {
      active = false;
    };
  }, [showError]);

  const saveDocument = useCallback(
    async (forceSaveAs = false): Promise<boolean> => {
      try {
        if (recoveryTimer.current) window.clearTimeout(recoveryTimer.current);
        let path = currentPathRef.current;
        if (!path || forceSaveAs) {
          const selected = await save({
            defaultPath: path ?? "Untitled.excalidraw",
            filters: drawingFilter,
          });
          if (!selected) return false;
          path = selected.toLowerCase().endsWith(".excalidraw") ? selected : `${selected}.excalidraw`;
        }
        const contents = currentJson.current || savedJson.current;
        await invoke("write_drawing", { path, contents });
        savedJson.current = contents;
        setPath(path);
        dirtyRef.current = currentJson.current !== contents;
        setDirty(dirtyRef.current);
        setNotice(dirtyRef.current ? "Saved. Newer changes remain unsaved." : "Saved");
        if (dirtyRef.current) {
          scheduleRecovery(currentJson.current, path);
        } else {
          await invoke("clear_recovery");
        }
        await remember(path);
        return true;
      } catch (error) {
        showError(error);
        return false;
      }
    },
    [remember, scheduleRecovery, setPath, showError],
  );

  const performAction = useCallback(
    async (action: FileAction) => {
      if (action.type === "new") {
        await installScene({ elements: [] }, null);
      } else if (action.type === "open") {
        await installScene(action.scene, action.path);
      } else {
        await invoke("clear_recovery");
        allowClose.current = true;
        await getCurrentWindow().close();
      }
    },
    [installScene],
  );

  const requestAction = useCallback(
    async (action: FileAction) => {
      if (dirtyRef.current) {
        setPendingAction(action);
        return;
      }
      await performAction(action);
    },
    [performAction],
  );

  const openPath = useCallback(
    async (path: string) => {
      try {
        const { parsed } = await readScene(path);
        setRecentOpen(false);
        await requestAction({ type: "open", path, scene: parsed });
      } catch (error) {
        showError(`Could not open ${fileName(path)}: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    [readScene, requestAction, showError],
  );

  const chooseFile = useCallback(async () => {
    try {
      const selected = await open({ multiple: false, filters: drawingFilter });
      if (typeof selected === "string") await openPath(selected);
    } catch (error) {
      showError(error);
    }
  }, [openPath, showError]);

  const startNew = useCallback(() => requestAction({ type: "new" }), [requestAction]);

  const onChange = useCallback(
    (elements: Parameters<typeof serializeAsJSON>[0], appState: Parameters<typeof serializeAsJSON>[1], files: Parameters<typeof serializeAsJSON>[2]) => {
      if (!ready) return;
      const contents = serializeAsJSON(elements, appState, files, "local");
      currentJson.current = contents;
      dirtyRef.current = contents !== savedJson.current;
      setDirty(dirtyRef.current);
      setNotice("");
      if (dirtyRef.current) {
        scheduleRecovery(contents);
      } else {
        if (recoveryTimer.current) window.clearTimeout(recoveryTimer.current);
        invoke("clear_recovery").catch(showError);
      }
    },
    [ready, scheduleRecovery],
  );

  const resolvePending = useCallback(
    async (decision: "save" | "discard" | "cancel") => {
      const action = pendingAction;
      if (!action) return;
      if (decision === "cancel") {
        setPendingAction(null);
        return;
      }
      if (decision === "save") {
        const saved = await saveDocument();
        if (!saved || dirtyRef.current) return;
      } else {
        try {
          await invoke("clear_recovery");
          dirtyRef.current = false;
          setDirty(false);
        } catch (error) {
          showError(error);
          return;
        }
      }
      await performAction(action);
    },
    [pendingAction, performAction, saveDocument, showError],
  );

  const restoreRecovery = useCallback(async () => {
    if (!recoverySnapshot) return;
    try {
      const parsed = await parseDrawing(recoverySnapshot.drawing);
      const path = recoverySnapshot.source_path;
      let baseline: string | undefined;
      if (path) {
        try {
          baseline = (await readScene(path)).baseline;
        } catch {
          baseline = "";
        }
      } else {
        baseline = "";
      }
      await installScene(parsed, path, baseline);
      setRecoverySnapshot(null);
    } catch (error) {
      showError(`Could not restore recovery data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [installScene, readScene, recoverySnapshot, showError]);

  const discardRecovery = useCallback(async () => {
    try {
      await invoke("clear_recovery");
      setRecoverySnapshot(null);
    } catch (error) {
      showError(error);
    }
  }, [showError]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (allowClose.current) return;
        event.preventDefault();
        await requestAction({ type: "close" });
      })
      .then((dispose) => {
        unlisten = dispose;
      })
      .catch(showError);
    return () => unlisten?.();
  }, [requestAction, showError]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey;
      if (!modifier) return;
      const key = event.key.toLowerCase();
      if (key === "s") {
        event.preventDefault();
        void saveDocument(event.shiftKey);
      } else if (key === "o") {
        event.preventDefault();
        void chooseFile();
      } else if (key === "n") {
        event.preventDefault();
        void startNew();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [chooseFile, saveDocument, startNew]);

  useEffect(() => () => {
    if (recoveryTimer.current) window.clearTimeout(recoveryTimer.current);
  }, []);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-icon"><PencilRuler size={17} strokeWidth={2.2} /></div>
          <div className="brand-text"><span>excalidraw</span><small>DESKTOP</small></div>
        </div>

        <div className="document-name" title={currentPath ?? "Untitled drawing"}>
          <span className={`save-indicator ${dirty ? "is-dirty" : ""}`} />
          <span className="document-title">{currentPath ? fileName(currentPath) : "Untitled drawing"}</span>
          {dirty && <span className="unsaved-label">Unsaved</span>}
        </div>

        <nav className="actions" aria-label="Drawing actions">
          <button className="icon-button" onClick={startNew} title="New drawing (Ctrl+N)" aria-label="New drawing"><FilePlus2 size={17} /></button>
          <button className="action-button secondary" onClick={chooseFile}><FolderOpen size={16} /> <span>Open</span></button>
          <button className="action-button primary" onClick={() => void saveDocument()}><Save size={16} /> <span>Save</span><kbd>Ctrl S</kbd></button>
          <button className="action-button secondary save-as-button" onClick={() => void saveDocument(true)}><Save size={15} /> <span>Save as</span></button>
          <div className="recent-wrap">
            <button className={`icon-button recent-trigger ${recentOpen ? "selected" : ""}`} onClick={() => setRecentOpen((value) => !value)} title="Recent drawings" aria-label="Recent drawings"><Clock3 size={17} /><ChevronDown size={12} /></button>
            {recentOpen && (
              <div className="recent-menu">
                <div className="menu-heading">Recent drawings</div>
                {recentFiles.length === 0 ? (
                  <div className="empty-recent">Files you open or save will show here.</div>
                ) : recentFiles.map((path) => (
                  <button key={path} className="recent-item" onClick={() => void openPath(path)} title={path}>
                    <span className="recent-file-icon"><PencilRuler size={15} /></span>
                    <span className="recent-file-copy"><strong>{fileName(path)}</strong><small>{path}</small></span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </nav>
      </header>

      {notice && <div className="notice" role="status"><AlertCircle size={15} />{notice}<button onClick={() => setNotice("")} aria-label="Dismiss message"><X size={14} /></button></div>}

      <section className="canvas-frame" aria-label="Drawing canvas">
        <Excalidraw
          key={sceneKey}
          initialData={scene}
          onChange={onChange}
        />
      </section>

      <footer className="statusbar">
        <span className="status-left"><span className="offline-dot" />Works offline</span>
        <span>{dirty ? "Changes are stored for recovery" : notice === "Saved" ? "All changes saved" : "Ready"}</span>
      </footer>

      {pendingAction && (
        <div className="modal-backdrop" role="presentation">
          <section className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="unsaved-title">
            <div className="dialog-mark"><Save size={19} /></div>
            <h1 id="unsaved-title">Save your changes?</h1>
            <p>Your drawing has unsaved changes. Save them before {pendingAction.type === "close" ? "closing" : pendingAction.type === "new" ? "starting a new drawing" : "opening another file"}?</p>
            <div className="dialog-actions">
              <button className="dialog-text-button" onClick={() => void resolvePending("cancel")}>Cancel</button>
              <button className="dialog-secondary-button" onClick={() => void resolvePending("discard")}>Discard</button>
              <button className="dialog-primary-button" onClick={() => void resolvePending("save")}>Save changes</button>
            </div>
          </section>
        </div>
      )}

      {recoverySnapshot && !pendingAction && (
        <div className="modal-backdrop" role="presentation">
          <section className="dialog-card recovery-card" role="dialog" aria-modal="true" aria-labelledby="recovery-title">
            <div className="dialog-mark recovery-mark"><Clock3 size={19} /></div>
            <span className="eyebrow">RECOVERY AVAILABLE</span>
            <h1 id="recovery-title">Restore your last session?</h1>
            <p>A newer local draft was found{recoverySnapshot.source_path ? ` for ${fileName(recoverySnapshot.source_path)}` : ""}. Your drawing file has not been changed.</p>
            <div className="recovery-time">Last edited {new Date(recoverySnapshot.updated_at).toLocaleString()}</div>
            <div className="dialog-actions">
              <button className="dialog-text-button" onClick={() => void discardRecovery()}>Discard draft</button>
              <button className="dialog-primary-button" onClick={() => void restoreRecovery()}>Restore draft</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
