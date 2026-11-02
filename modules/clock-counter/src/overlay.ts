import { watchOverlay } from "@tavora/sdk";
import type { OverlayState } from "./items";
import { isLive, rowText, type LiveState } from "./live";
import { mountOverlayView } from "./overlay-view";
import { FIT_PADDING } from "./sources";
import "./overlay.css";

const root = document.getElementById("overlay")!;
const live = document.getElementById("live")!;
// A little room around the text, as a new frame is sized with (sources.ts); the text fills the rest of the window.
const view = mountOverlayView(root, { box: () => ({ width: innerWidth, height: innerHeight }), padding: FIT_PADDING, grow: true });

/** The state of one item (OBS, or one item over the game), or of all a panel's items (its live view over the game). */
let state: OverlayState | LiveState | null = null;
let timer: ReturnType<typeof setInterval> | undefined;

/** The live view: one row per clock or counter. Drawn again on every tick, which is cheap for a few rows. */
function drawLive(snapshot: LiveState): void {
  root.hidden = true;
  live.hidden = false;
  const rows = snapshot.rows.map((row) => {
    const { name: words, text, flashing } = rowText(row, Date.now());
    const item = document.createElement("li");
    item.style.setProperty("--color", row.look.color);
    item.style.setProperty("--words", row.look.wordsColor ?? row.look.color);
    item.dataset.font = row.look.font;
    item.dataset.outline = String(row.look.outline);
    if (flashing) item.dataset.done = "flash";
    if (words) {
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = words;
      item.append(name);
    }
    const amount = document.createElement("span");
    amount.className = "amount";
    amount.textContent = text;
    item.append(amount);
    return item;
  });
  if (snapshot.more > 0) {
    const more = document.createElement("li");
    more.className = "more";
    more.textContent = snapshot.moreText.replace("{count}", String(snapshot.more));
    rows.push(more);
  }
  live.replaceChildren(...rows);
}

function draw(): void {
  if (state && isLive(state)) return drawLive(state);
  live.hidden = true;
  view.draw(state);
  // The font may still be loading for this text; fit again once it has (a wider font would run off the source).
  void document.fonts.ready.then(() => view.fit());
}

watchOverlay((next) => {
  state = next as OverlayState | LiveState | null;
  clearInterval(timer);
  // A running clock ticks; anything else only changes when the panel publishes.
  const ticking = state && isLive(state) ? state.rows.some((row) => row.kind === "clock" && row.clock.since !== null) : state?.kind === "clock" && state.clock.since !== null;
  if (ticking) timer = setInterval(draw, 250);
  draw();
});

addEventListener("resize", () => view.fit());
void document.fonts.ready.then(() => view.fit());
