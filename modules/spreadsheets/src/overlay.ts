// The page Tavora shows over the game while the Spreadsheets panel is closed. It has no bridge: it draws what the
// panel passed to panel.setLive (watchOverlay), read-only and click-through.
import { watchOverlay } from "@tavora/sdk";
import { readLiveState, type LiveState } from "./live";
import { drawPlate } from "./plate";
import "./overlay.css";

const plate = document.getElementById("plate")!;
let state: LiveState | null = null;
const draw = () => drawPlate(plate, state);

watchOverlay((next) => {
  state = readLiveState(next);
  draw();
});

addEventListener("resize", draw);
// A font that arrives after the first draw changes how much fits.
void document.fonts.ready.then(draw);
