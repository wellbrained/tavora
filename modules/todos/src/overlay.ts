// The page Tavora shows over the game while the To-Dos panel is closed. It has no bridge: it draws what the panel
// passed to panel.setLive (watchOverlay), read-only. A list too long for the window is cut with "+N more".
import { watchOverlay } from "@tavora/sdk";
import type { LiveState } from "./live";
import { drawPlate, readState } from "./plate";
import "./overlay.css";

const plate = document.getElementById("plate")!;
let state: LiveState | null = null;

const draw = () => drawPlate(plate, state);

watchOverlay((next) => {
  state = readState(next);
  draw();
});

addEventListener("resize", draw);
// A font that arrives after the first draw changes how much fits.
void document.fonts.ready.then(draw);
