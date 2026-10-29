// Draws the live view's plate: the overlay page over the game and the preview in the settings both use it, so the
// preview looks exactly like the real thing. Styles are in plate.css.
import type { JsonValue } from "@tavora/sdk";
import { fontStack, LIVE_SIZES, parseLook, type LiveLook, type LiveRow, type LiveState } from "./live";
import "./fonts.css";
import "./plate.css";

type JsonObject = { [key: string]: JsonValue };
const isObject = (value: JsonValue | undefined): value is JsonObject => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * A live state as the overlay got it. Tavora keeps the last state while no panel runs, so it may still come from the
 * version before, which had no look and no row kinds: those read as the defaults.
 */
export function readState(raw: JsonValue | null): LiveState | null {
  if (!isObject(raw ?? null)) return null;
  const state = raw as JsonObject;
  const rows = (Array.isArray(state.rows) ? state.rows : []).filter(isObject).map(
    (row): LiveRow =>
      row.kind === "group"
        ? { kind: "group", text: String(row.text ?? "") }
        : {
            kind: "task",
            text: String(row.text ?? ""),
            pinned: row.pinned === true,
            done: row.done === true,
            progress: typeof row.progress === "string" ? row.progress : null,
            depth: typeof row.depth === "number" ? row.depth : 0,
          },
  );
  return {
    rows,
    more: typeof state.more === "number" ? state.more : 0,
    moreText: typeof state.moreText === "string" ? state.moreText : "+{count}",
    look: parseLook(isObject(state.look) ? state.look : state),
  };
}

function hexToRgb(hex: string): string {
  const value = parseInt(hex.slice(1), 16);
  return `${value >> 16} ${(value >> 8) & 255} ${value & 255}`;
}

/** Sets the plate's look as CSS variables and classes. */
function style(plate: HTMLElement, look: LiveLook): void {
  plate.style.setProperty("--plate", `rgb(${hexToRgb(look.backgroundColor)} / ${look.background / 100})`);
  plate.style.setProperty("--padding", `${look.padding}px`);
  plate.style.setProperty("--text", look.color);
  plate.style.fontFamily = fontStack(look.font);
  plate.style.fontSize = `${LIVE_SIZES[look.size]}px`;
  plate.classList.toggle("bold", look.bold);
  plate.classList.toggle("outline", look.outline);
  plate.classList.toggle("lines", look.headers === "line");
}

function line(row: LiveRow, first: boolean): HTMLLIElement {
  const item = document.createElement("li");
  if (row.kind === "group") {
    item.className = first ? "head first" : "head";
    item.textContent = row.text;
    return item;
  }
  item.className = row.done ? "task done" : "task";
  if (row.depth) item.style.paddingLeft = `${row.depth * 1.2}em`;
  const mark = document.createElement("span");
  mark.className = row.pinned ? "mark pin" : "mark box";
  if (row.pinned) mark.textContent = "\u{1F4CC}";
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

/** Fills the plate with the state, dropping lines from the end until it fits its box. Hidden when there is nothing to show. */
export function drawPlate(plate: HTMLElement, state: LiveState | null): void {
  if (!state || state.rows.length === 0) {
    plate.hidden = true;
    plate.replaceChildren();
    return;
  }
  const { rows, more, moreText, look } = state;
  plate.hidden = false;
  style(plate, look);
  const items = rows.map((row, index) => line(row, index === 0));
  const isTask = (at: number) => rows[at]!.kind === "task";
  let shown = items.length;
  const fill = () => {
    const rest = more + rows.slice(shown).filter((row) => row.kind === "task").length;
    plate.replaceChildren(...items.slice(0, shown), ...(rest > 0 ? [moreLine(rest, moreText)] : []));
  };
  fill();
  while (shown > 1 && plate.scrollHeight > plate.clientHeight + 1) {
    shown--;
    // Never end on a heading.
    while (shown > 1 && !isTask(shown - 1)) shown--;
    fill();
  }
}
