// Mounts one of the two pages of the Overlay layout window (main/overlay-layout-window.ts): the shell with the toolbar,
// the list and the canvas background, or the layer on the canvas that takes the mouse. The address says which.
import "./styles.css";
import { createApp } from "vue";
import { installTitleTooltips } from "@tavora/official-ui/title-tooltips";
import LayoutCanvas from "./components/layout/LayoutCanvas.vue";
import LayoutApp from "./components/layout/LayoutApp.vue";
import { firstState } from "./host";

const layer = location.hash === "#layer";
if (layer) document.documentElement.style.background = "transparent";
await firstState.catch(() => undefined);
createApp(layer ? LayoutCanvas : LayoutApp).mount("#app");
if (!layer) installTitleTooltips(document, { onOpenChange: () => {} });
