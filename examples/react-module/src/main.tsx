import { StrictMode, useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  connect,
  TavoraError,
  type TavoraDocument,
  type TavoraGame,
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
  game: TavoraGame;
  viewport: TavoraViewport;
  theme: TavoraTheme;
  count: number;
  note: (TavoraDocument & { data: Note }) | null;
  view: View;
}

async function load(): Promise<Initial> {
  const tavora = await connect();
  const [game, viewport, theme, count, note, panel] = await Promise.all([
    tavora.game.getCurrent(),
    tavora.workspace.getViewport(),
    tavora.ui.getTheme(),
    tavora.storage.get<number>("count"),
    tavora.documents.get<Note>("note"),
    tavora.panel.getState<{ view: View }>(),
  ]);
  return { tavora, game, viewport, theme, count: count ?? 0, note, view: panel?.view ?? "list" };
}

const h2: CSSProperties = { fontSize: 14, margin: "16px 0 4px" };
const dd: CSSProperties = { margin: "0 0 8px" };

function Counter({ tavora, initial, button }: { tavora: TavoraSDK; initial: number; button: CSSProperties }) {
  const [count, setCount] = useState(initial);
  const increment = async () => {
    const next = count + 1;
    setCount(next);
    await tavora.storage.set("count", next);
  };
  return (
    <section>
      <h2 style={h2}>Clicks saved for this game</h2>
      <p data-testid="count">{count}</p>
      <button type="button" data-testid="increment" onClick={() => void increment()} style={button}>
        Add a click
      </button>
    </section>
  );
}

/** A document shared by every panel of this module, saved with a revision check. */
function SharedNote({ tavora, initial, button }: { tavora: TavoraSDK; initial: Initial["note"]; button: CSSProperties }) {
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
      <h2 style={h2}>
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
        style={{ boxSizing: "border-box", width: "100%", font: "inherit" }}
      />
      <p>
        <button type="button" data-testid="save-note" onClick={() => void save()} style={button}>
          Save note
        </button>{" "}
        <span data-testid="note-status">{status}</span>
      </p>
    </section>
  );
}

/** Panel state: which view this one panel shows. Gone once the panel is closed. */
function PanelView({ tavora, initial, button }: { tavora: TavoraSDK; initial: View; button: CSSProperties }) {
  const [view, setView] = useState(initial);
  const choose = async (next: View) => {
    setView(next);
    await tavora.panel.setState({ view: next });
  };
  return (
    <section>
      <h2 style={h2}>
        This panel's view: <span data-testid="view">{view}</span>
      </h2>
      {(["list", "grid"] as const).map((option) => (
        <button
          key={option}
          type="button"
          data-testid={`view-${option}`}
          onClick={() => void choose(option)}
          style={{ ...button, marginRight: 4 }}
        >
          {option === "list" ? "List" : "Grid"}
        </button>
      ))}
    </section>
  );
}

function Module({ initial }: { initial: Initial }) {
  const { tavora, game } = initial;
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
  const button: CSSProperties = { background: colors.accent, border: 0, borderRadius: 6, padding: "6px 12px" };
  const muted = { color: colors.textMuted };

  return (
    <Page background={colors.background} text={colors.text}>
      <p data-testid="status">Connected</p>
      <dl>
        <dt style={muted}>Game</dt>
        <dd data-testid="game" data-game-id={game.id} style={dd}>
          {game.displayName}
        </dd>
        <dt style={muted}>Viewport</dt>
        <dd data-testid="viewport" style={dd}>
          {`${viewport.width} × ${viewport.height}`}
        </dd>
        <dt style={muted}>Theme</dt>
        <dd data-testid="theme" style={dd}>
          {theme.mode}
        </dd>
        <dt style={muted}>Panel</dt>
        <dd data-testid="lifecycle" style={dd}>
          {lifecycle}
        </dd>
      </dl>
      <Counter tavora={tavora} initial={initial.count} button={button} />
      <SharedNote tavora={tavora} initial={initial.note} button={button} />
      <PanelView tavora={tavora} initial={initial.view} button={button} />
    </Page>
  );
}

function Page({ background, text, children }: { background: string; text: string; children: ReactNode }) {
  return (
    <main
      style={{
        padding: 16,
        minHeight: "100vh",
        boxSizing: "border-box",
        background,
        color: text,
        font: "14px/1.5 system-ui, sans-serif",
      }}
    >
      <h1 style={{ fontSize: 16, margin: "0 0 8px" }}>React Test Module</h1>
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
    <Page background="#18181b" text="#f2ece0">
      <p data-testid="status">{error ? `Could not connect: ${error}` : "Connecting…"}</p>
    </Page>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
