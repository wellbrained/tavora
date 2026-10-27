// Mounts the layer on the Overlay page's canvas (main/overlay-canvas.ts): a transparent page of Tavora's own that takes the
// mouse and the keys over the live pages.
import "./styles.css";
import { createApp } from "vue";
import LayoutCanvas from "./components/layout/LayoutCanvas.vue";
import { firstState } from "./host";

document.documentElement.style.background = "transparent";
await firstState.catch(() => undefined);
createApp(LayoutCanvas).mount("#app");
