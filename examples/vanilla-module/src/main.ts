import { connect, type TavoraTheme } from "@tavora/sdk";

const el = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
const button = el("increment") as HTMLButtonElement;

function applyTheme(theme: TavoraTheme) {
  el("theme").textContent = theme.mode;
  const style = document.documentElement.style;
  style.setProperty("--bg", theme.colors.background);
  style.setProperty("--text", theme.colors.text);
  style.setProperty("--muted", theme.colors.textMuted);
  style.setProperty("--accent", theme.colors.accent);
}

try {
  const tavora = await connect();
  const [game, viewport, theme, saved] = await Promise.all([
    tavora.game.getCurrent(),
    tavora.workspace.getViewport(),
    tavora.ui.getTheme(),
    tavora.storage.get<number>("count"),
  ]);

  let count = saved ?? 0;
  el("game").textContent = game.displayName;
  el("game").dataset.gameId = game.id;
  el("viewport").textContent = `${viewport.width} × ${viewport.height}`;
  el("count").textContent = String(count);
  applyTheme(theme);

  tavora.workspace.onResize(({ width, height }) => {
    el("viewport").textContent = `${width} × ${height}`;
  });
  tavora.ui.onThemeChange(applyTheme);

  button.addEventListener("click", async () => {
    count += 1;
    el("count").textContent = String(count);
    await tavora.storage.set("count", count);
  });
  button.disabled = false;
  el("status").textContent = "Connected";
} catch (error) {
  el("status").textContent = `Could not connect: ${error instanceof Error ? error.message : String(error)}`;
}
