// The page Tavora shows over the game while the To-Dos panel is closed. It has no bridge: it draws what the panel
// passed to panel.setLive (watchOverlay), read-only. A list too long for the window is cut with "+N more".
import { watchOverlay } from "@tavora/sdk";
import type { LiveState } from "./live";
import "./overlay.css";

const plate = document.getElementById("plate")!;
let state: LiveState | null = null;

function line(row: LiveState["rows"][number]): HTMLLIElement {
  const item = document.createElement("li");
  if (row.depth) item.style.paddingLeft = `${row.depth * 1.2}em`;
  const mark = document.createElement("span");
  mark.className = "mark";
  mark.textContent = row.pinned ? "\u{1F4CC}" : row.depth ? "◦" : "•";
  const text = document.createElement("span");
  text.className = "text";
  text.textContent = row.text;
  item.append(mark, text);
  if (row.progress) {
    const progress = document.createElement("span");
    progress.className = "progress";
    progress.textContent = row.progress;
    item.append(progress);
  }
  return item;
}

function moreLine(count: number, template: string): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "more";
  item.textContent = template.replace("{count}", String(count));
  return item;
}

function draw(): void {
  if (!state || state.rows.length === 0) {
    plate.hidden = true;
    plate.replaceChildren();
    return;
  }
  const { rows, more, moreText, background, padding } = state;
  plate.hidden = false;
  plate.style.setProperty("--opacity", String(background / 100));
  plate.style.setProperty("--padding", `${padding}px`);
  const items = rows.map(line);
  let shown = items.length;
  const fill = () => {
    const rest = more + items.length - shown;
    plate.replaceChildren(...items.slice(0, shown), ...(rest > 0 ? [moreLine(rest, moreText)] : []));
  };
  fill();
  // Drop lines from the end until the plate fits the window.
  while (shown > 1 && plate.scrollHeight > plate.clientHeight + 1) {
    shown--;
    fill();
  }
}

watchOverlay((next) => {
  state = next as LiveState | null;
  draw();
});

addEventListener("resize", draw);
