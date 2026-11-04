// Draws the live view's plate: a small read-only table of the chosen cells. The overlay page over the game and the
// preview in the settings both use it, so the preview looks exactly like the real thing. Styles are in plate.css.
import { LIVE_SIZES, type LiveCell, type LiveState } from "./live";
import { cssRgb, DARK, DARK_TEXT } from "./palette";
import "./plate.css";

function cell(item: LiveCell, header: boolean): HTMLTableCellElement {
  const td = document.createElement(header ? "th" : "td");
  if (item.a) td.dataset.align = item.a;
  if (item.b || header) td.classList.add("bold");
  if (item.i) td.classList.add("italic");
  if (item.c) td.style.color = cssRgb(DARK[item.c]);
  if (item.f) td.style.background = cssRgb(DARK[item.f], 0.28);
  if (item.k === "check") {
    const box = document.createElement("span");
    box.className = item.v ? "box ticked" : "box";
    td.append(box);
    return td;
  }
  if (item.k === "pill" && item.t) {
    const pill = document.createElement("span");
    pill.className = "pill";
    if (item.p) {
      pill.style.background = cssRgb(DARK[item.p], 0.3);
      pill.style.color = cssRgb(DARK[item.p]);
    }
    pill.textContent = item.t;
    td.append(pill);
    return td;
  }
  td.textContent = item.t;
  return td;
}

/** Fills the plate with the state, dropping rows from the end until it fits its box. Hidden when there is nothing to show. */
export function drawPlate(plate: HTMLElement, state: LiveState | null): void {
  if (!state || state.rows.length === 0) {
    plate.hidden = true;
    plate.replaceChildren();
    return;
  }
  plate.hidden = false;
  const scale = LIVE_SIZES[state.look.size] / LIVE_SIZES.m;
  plate.style.setProperty("--plate", String(state.look.opacity / 100));
  plate.style.setProperty("--padding", `${state.look.padding}px`);
  plate.style.setProperty("--text", cssRgb(DARK_TEXT));
  plate.style.fontSize = `${LIVE_SIZES[state.look.size]}px`;
  const build = (count: number) => {
    const table = document.createElement("table");
    const columns = document.createElement("colgroup");
    for (const width of state.widths) {
      const col = document.createElement("col");
      col.style.width = `${Math.round(width * scale)}px`;
      columns.append(col);
    }
    table.append(columns);
    state.rows.slice(0, count).forEach((row, index) => {
      const tr = document.createElement("tr");
      tr.append(...row.map((item) => cell(item, state.header && index === 0)));
      table.append(tr);
    });
    const rest = state.more + state.rows.length - count;
    const parts: HTMLElement[] = [table];
    if (rest > 0) {
      const more = document.createElement("p");
      more.className = "more";
      more.textContent = state.moreText.replace("{count}", String(rest));
      parts.push(more);
    }
    plate.replaceChildren(...parts);
  };
  let shown = state.rows.length;
  build(shown);
  while (shown > 1 && plate.scrollHeight > plate.clientHeight + 1) build(--shown);
}
