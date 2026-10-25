import { createApp } from "vue";
import "./style.css";

// Excalidraw loads its fonts by address. They are copied into dist/fonts at build time, so it is pointed there
// before it is loaded (the dynamic import makes sure of the order) and nothing is fetched from the internet.
(window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH = new URL("./", window.location.href).href;

void import("./App.vue").then(({ default: App }) => {
  createApp(App).mount("#app");
});
