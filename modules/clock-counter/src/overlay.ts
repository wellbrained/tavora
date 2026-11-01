// The overlay page OBS shows as a Browser Source. It runs outside Tavora, so it has no bridge: it reads what the
// panel published for its item (watchOverlay) and draws it. A running clock is counted here from its start time,
// so the panel publishes only when something changes.
import { watchOverlay } from "@tavora/sdk";
import { readClock, type OverlayState } from "./items";
import { isLive, rowText, type LiveState } from "./live";
import { FIT_PADDING, GAP_SHARE, LABEL_SHARE, LAP_SHARE, LINE_HEIGHT } from "./sources";
import { formatSeconds } from "./time";
import "./overlay.css";

const root = document.getElementById("overlay")!;
// A little room around the text, as a new frame is sized with (sources.ts).
root.style.padding = `${FIT_PADDING}px`;
const line = root.querySelector<HTMLElement>(".line")!;
const label = root.querySelector<HTMLElement>(".label")!;
const value = root.querySelector<HTMLElement>(".value")!;
const lap = root.querySelector<HTMLElement>(".lap")!;
const live = document.getElementById("live")!;

/** The state of one item (OBS, or one item over the game), or of all a panel's items (its live view over the game). */
let state: OverlayState | LiveState | null = null;
let timer: ReturnType<typeof setInterval> | undefined;

/**
 * Sizes the text to fill the source, however big it is in OBS: the value takes most of the height, the name beside it is half
 * its size on the same baseline with a steady gap, and the last lap goes under them. The shares are the ones sources.ts
 * measures a new frame with.
 */
function fit(): void {
  const lapShown = lap.textContent !== "";
  const height = (innerHeight - 2 * FIT_PADDING) / (1 + (lapShown ? LAP_SHARE : 0)) / LINE_HEIGHT;
  const size = (scale: number) => {
    value.style.fontSize = `${height * scale}px`;
    label.style.fontSize = `${height * scale * LABEL_SHARE}px`;
    line.style.gap = label.textContent ? `${height * scale * GAP_SHARE}px` : "0";
    lap.style.fontSize = `${height * scale * LAP_SHARE}px`;
  };
  size(1);
  // Too wide for the source: shrink everything together.
  const widest = Math.max(line.offsetWidth, lapShown ? lap.offsetWidth : 0);
  const room = innerWidth - 2 * FIT_PADDING;
  if (widest > room) size(Math.max(room, 1) / widest);
}

/** The live view: one row per clock or counter. Drawn again on every tick, which is cheap for a few rows. */
function drawLive(view: LiveState): void {
  root.hidden = true;
  live.hidden = false;
  const rows = view.rows.map((row) => {
    const { text, flashing } = rowText(row, Date.now());
    const item = document.createElement("li");
    item.style.setProperty("--color", row.look.color);
    item.dataset.font = row.look.font;
    item.dataset.outline = String(row.look.outline);
    if (flashing) item.dataset.done = "flash";
    if (row.look.showLabel && row.label) {
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = row.label;
      item.append(name);
    }
    const amount = document.createElement("span");
    amount.className = "amount";
    amount.textContent = text;
    item.append(amount);
    return item;
  });
  if (view.more > 0) {
    const more = document.createElement("li");
    more.className = "more";
    more.textContent = view.moreText.replace("{count}", String(view.more));
    rows.push(more);
  }
  live.replaceChildren(...rows);
}

function draw(): void {
  if (state && isLive(state)) return drawLive(state);
  live.hidden = true;
  if (!state) {
    root.hidden = true;
    return;
  }
  root.hidden = false;
  const { look } = state;
  root.style.setProperty("--color", look.color);
  root.dataset.font = look.font;
  root.dataset.align = look.align;
  root.dataset.outline = String(look.outline);
  label.textContent = state.kind !== "group" && look.showLabel ? state.label : "";
  delete root.dataset.done;
  if (state.kind === "group") {
    // A linked group: the line the user wrote, with the values in.
    value.textContent = state.line;
    lap.textContent = "";
  } else if (state.kind === "counter") {
    value.textContent = state.goal === null ? String(state.value) : `${state.value} / ${state.goal}`;
    lap.textContent = "";
  } else {
    const clock = { ...state.clock, laps: false, showLastLap: false, lapTimes: [] };
    const reading = readClock({ id: "", label: "", look, ...clock }, Date.now());
    if (reading.done && state.clock.doneText) value.textContent = state.clock.doneText;
    else value.textContent = formatSeconds(reading.seconds, state.clock.format);
    if (reading.done && !state.clock.doneText) root.dataset.done = "flash";
    lap.textContent = state.lastLap === null ? "" : formatSeconds(Math.floor(state.lastLap / 1000), state.clock.format);
  }
  fit();
  // The font may still be loading for this text; fit again once it has (a wider font would run off the source).
  void document.fonts.ready.then(fit);
}

watchOverlay((next) => {
  state = next as OverlayState | LiveState | null;
  clearInterval(timer);
  // A running clock ticks; anything else only changes when the panel publishes.
  const ticking = state && isLive(state) ? state.rows.some((row) => row.kind === "clock" && row.clock.since !== null) : state?.kind === "clock" && state.clock.since !== null;
  if (ticking) timer = setInterval(draw, 250);
  draw();
});

addEventListener("resize", fit);
void document.fonts.ready.then(fit);
