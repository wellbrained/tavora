// The overlay page OBS shows as a Browser Source. It runs outside Tavora, so it has no bridge: it reads what the
// panel published for its item (watchOverlay) and draws it. A running clock is counted here from its start time,
// so the panel publishes only when something changes.
import { watchOverlay } from "@tavora/sdk";
import { readClock, type OverlayState } from "./items";
import { formatSeconds } from "./time";
import "./overlay.css";

const root = document.getElementById("overlay")!;
const label = root.querySelector<HTMLElement>(".label")!;
const value = root.querySelector<HTMLElement>(".value")!;
const lap = root.querySelector<HTMLElement>(".lap")!;

let state: OverlayState | null = null;
let timer: ReturnType<typeof setInterval> | undefined;

/** Sizes the text to fill the source, however big it is in OBS: the value takes most of the height. */
function fit(): void {
  const lines = [label, value, lap].filter((line) => line.textContent !== "");
  const share = { label: 0.28, value: 1, lap: 0.32 };
  const total = lines.reduce((sum, line) => sum + (line === value ? share.value : line === label ? share.label : share.lap), 0);
  const height = (innerHeight * 0.96) / Math.max(total, 1) / 1.05;
  value.style.fontSize = `${height}px`;
  label.style.fontSize = `${height * share.label}px`;
  lap.style.fontSize = `${height * share.lap}px`;
  // Too wide for the source: shrink everything together.
  const widest = Math.max(...lines.map((line) => line.offsetWidth));
  const room = innerWidth * 0.98;
  if (widest > room) {
    const scale = room / widest;
    for (const line of [label, value, lap]) line.style.fontSize = `${parseFloat(line.style.fontSize) * scale}px`;
  }
}

function draw(): void {
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
  label.textContent = look.showLabel ? state.label : "";
  delete root.dataset.done;
  if (state.kind === "counter") {
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
}

watchOverlay((next) => {
  state = next as OverlayState | null;
  clearInterval(timer);
  // A running clock ticks; anything else only changes when the panel publishes.
  if (state?.kind === "clock" && state.clock.since !== null) timer = setInterval(draw, 250);
  draw();
});

addEventListener("resize", fit);
void document.fonts.ready.then(fit);
