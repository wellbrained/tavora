import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { connect, type TavoraGame, type TavoraSDK, type TavoraTheme, type TavoraViewport } from "@tavora/sdk";

interface Connected {
  tavora: TavoraSDK;
  game: TavoraGame;
}

function App() {
  const [connection, setConnection] = useState<Connected | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewport, setViewport] = useState<TavoraViewport | null>(null);
  const [theme, setTheme] = useState<TavoraTheme | null>(null);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cleanup: (() => void)[] = [];
    let cancelled = false;
    (async () => {
      const tavora = await connect();
      const [game, initialViewport, initialTheme, saved] = await Promise.all([
        tavora.game.getCurrent(),
        tavora.workspace.getViewport(),
        tavora.ui.getTheme(),
        tavora.storage.get<number>("count"),
      ]);
      if (cancelled) return;
      setConnection({ tavora, game });
      setViewport(initialViewport);
      setTheme(initialTheme);
      setCount(saved ?? 0);
      cleanup = [tavora.workspace.onResize(setViewport), tavora.ui.onThemeChange(setTheme)];
    })().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
    return () => {
      cancelled = true;
      cleanup.forEach((fn) => fn());
    };
  }, []);

  const colors = theme?.colors;
  const increment = async () => {
    if (!connection || count === null) return;
    const next = count + 1;
    setCount(next);
    await connection.tavora.storage.set("count", next);
  };

  return (
    <main
      style={{
        padding: 16,
        minHeight: "100vh",
        boxSizing: "border-box",
        background: colors?.background ?? "#18181b",
        color: colors?.text ?? "#f2ece0",
        font: "14px/1.5 system-ui, sans-serif",
      }}
    >
      <h1 style={{ fontSize: 16, margin: "0 0 8px" }}>React Test Module</h1>
      <p data-testid="status">{error ? `Could not connect: ${error}` : connection ? "Connected" : "Connecting…"}</p>
      <dl>
        <dt style={{ color: colors?.textMuted }}>Game</dt>
        <dd data-testid="game" data-game-id={connection?.game.id} style={{ margin: "0 0 8px" }}>
          {connection?.game.displayName ?? "–"}
        </dd>
        <dt style={{ color: colors?.textMuted }}>Viewport</dt>
        <dd data-testid="viewport" style={{ margin: "0 0 8px" }}>
          {viewport ? `${viewport.width} × ${viewport.height}` : "–"}
        </dd>
        <dt style={{ color: colors?.textMuted }}>Theme</dt>
        <dd data-testid="theme" style={{ margin: "0 0 8px" }}>
          {theme?.mode ?? "–"}
        </dd>
        <dt style={{ color: colors?.textMuted }}>Clicks saved for this game</dt>
        <dd data-testid="count" style={{ margin: "0 0 8px" }}>
          {count ?? "–"}
        </dd>
      </dl>
      <button
        type="button"
        data-testid="increment"
        disabled={count === null}
        onClick={() => void increment()}
        style={{ background: colors?.accent ?? "#e0a243", border: 0, borderRadius: 6, padding: "6px 12px" }}
      >
        Add a click
      </button>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
