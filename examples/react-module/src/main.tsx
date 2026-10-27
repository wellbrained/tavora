import { StrictMode, useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import {
  connect,
  TavoraError,
  type TavoraDocument,
  type TavoraWorkspace,
  type TavoraSDK,
  type TavoraTheme,
  type TavoraViewport,
} from "@tavora/sdk";

// Same features and data-testid values as the vanilla example, so one set of
// end-to-end tests covers both.

interface Note {
  text: string;
}
type View = "list" | "grid";

/** Everything the module shows, loaded before it reports "Connected". */
interface Initial {
  tavora: TavoraSDK;
  workspace: TavoraWorkspace;
  viewport: TavoraViewport;
  theme: TavoraTheme;
  count: number;
  note: (TavoraDocument & { data: Note }) | null;
  view: View;
}

async function load(): Promise<Initial> {
  const tavora = await connect();
  const [workspace, viewport, theme, count, note, panel] = await Promise.all([
    tavora.workspace.getCurrent(),
    tavora.workspace.getViewport(),
    tavora.ui.getTheme(),
    tavora.storage.get<number>("count"),
    tavora.documents.get<Note>("note"),
    tavora.panel.getState<{ view: View }>(),
  ]);
  return { tavora, workspace, viewport, theme, count: count ?? 0, note, view: panel?.view ?? "list" };
}


function Counter({ tavora, initial, primary }: { tavora: TavoraSDK; initial: number; primary: CSSProperties }) {
  const [count, setCount] = useState(initial);
  const increment = async () => {
    const next = count + 1;
    setCount(next);
    await tavora.storage.set("count", next);
  };
  return (
    <section>
      <h2>Clicks saved in this workspace</h2>
      <p data-testid="count">{count}</p>
      <button type="button" data-testid="increment" onClick={() => void increment()} style={primary}>
        Add a click
      </button>
    </section>
  );
}

/** A document shared by every panel of this module, saved with a revision check. */
function SharedNote({ tavora, initial }: { tavora: TavoraSDK; initial: Initial["note"] }) {
  // Uncontrolled, so a reload from another panel replaces the text in one place.
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [revision, setRevision] = useState(initial?.revision ?? 0);
  const [status, setStatus] = useState("");

  const reload = useCallback(async () => {
    const note = await tavora.documents.get<Note>("note");
    if (textarea.current) textarea.current.value = note?.data.text ?? "";
    setRevision(note?.revision ?? 0);
  }, [tavora]);

  useEffect(
    () =>
      tavora.documents.onChange((change) => {
        if (change.id !== "note") return;
        void reload().then(() => setStatus("Updated in another panel"));
      }),
    [tavora, reload],
  );

  const save = async () => {
    try {
      const saved = await tavora.documents.put({
        id: "note",
        title: "Note",
        data: { text: textarea.current?.value ?? "" },
        ifRevision: revision,
      });
      setRevision(saved.revision);
      setStatus("Saved");
    } catch (error) {
      if (!(error instanceof TavoraError) || error.code !== "CONFLICT") throw error;
      // Someone else saved first: show their version instead of overwriting it.
      await reload();
      setStatus("Changed elsewhere; reloaded");
    }
  };

  return (
    <section>
      <h2>
        Shared note{" "}
        <small>
          revision <span data-testid="note-revision">{revision}</span>
        </small>
      </h2>
      <textarea
        data-testid="note"
        rows={3}
        ref={textarea}
        defaultValue={initial?.data.text ?? ""}
      />
      <p>
        <button type="button" data-testid="save-note" onClick={() => void save()}>
          Save note
        </button>{" "}
        <span data-testid="note-status">{status}</span>
      </p>
    </section>
  );
}

/** Panel state: which view this one panel shows. Gone once the panel is closed. */
function PanelView({ tavora, initial }: { tavora: TavoraSDK; initial: View }) {
  const [view, setView] = useState(initial);
  const choose = async (next: View) => {
    setView(next);
    await tavora.panel.setState({ view: next });
  };
  return (
    <section>
      <h2>
        This panel's view: <span data-testid="view">{view}</span>
      </h2>
      {(["list", "grid"] as const).map((option) => (
        <button
          key={option}
          type="button"
          data-testid={`view-${option}`}
          onClick={() => void choose(option)}
        >
          {option === "list" ? "List" : "Grid"}
        </button>
      ))}
    </section>
  );
}

function Module({ initial }: { initial: Initial }) {
  const { tavora, workspace } = initial;
  const [viewport, setViewport] = useState(initial.viewport);
  const [theme, setTheme] = useState(initial.theme);
  const [lifecycle, setLifecycle] = useState("active");

  useEffect(() => {
    const off = [
      tavora.workspace.onResize(setViewport),
      tavora.ui.onThemeChange(setTheme),
      tavora.lifecycle.onSuspend(() => setLifecycle("suspended")),
      tavora.lifecycle.onResume(() => setLifecycle("active")),
    ];
    return () => off.forEach((fn) => fn());
  }, [tavora]);

  const { colors } = theme;
  // Tavora styles buttons and fields already; the one main action gets the accent.
  const primary: CSSProperties = { background: colors.accent, color: colors.background };
  const muted = { color: colors.textMuted };

  return (
    <Page background={colors.background} text={colors.text}>
      <p data-testid="status">Connected</p>
      <dl>
        <dt style={muted}>Workspace</dt>
        <dd data-testid="workspace" data-workspace-id={workspace.id}>
          {workspace.displayName}
        </dd>
        <dt style={muted}>Viewport</dt>
        <dd data-testid="viewport">
          {`${viewport.width} × ${viewport.height}`}
        </dd>
        <dt style={muted}>Theme</dt>
        <dd data-testid="theme">
          {theme.mode}
        </dd>
        <dt style={muted}>Panel</dt>
        <dd data-testid="lifecycle">
          {lifecycle}
        </dd>
      </dl>
      <Counter tavora={tavora} initial={initial.count} primary={primary} />
      <SharedNote tavora={tavora} initial={initial.note} />
      <PanelView tavora={tavora} initial={initial.view} />
    </Page>
  );
}

function Page({ background, text, children }: { background: string; text: string; children: ReactNode }) {
  return (
    <main
      style={{
        background,
        color: text,
      }}
    >
      <h1>React Test Module</h1>
      {children}
    </main>
  );
}

function App() {
  const [initial, setInitial] = useState<Initial | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    load().then(
      (loaded) => !cancelled && setInitial(loaded),
      (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (initial) return <Module initial={initial} />;
  return (
    <Page background="#171412" text="#f2ece0">
      <p data-testid="status">{error ? `Could not connect: ${error}` : "Connecting…"}</p>
    </Page>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
