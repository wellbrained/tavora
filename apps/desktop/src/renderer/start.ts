// Mounts the host UI. main.ts loads this on its own, so a module that throws while loading
// (0.20.33 opened to a black window) ends up on the error screen instead.
import { createApp } from "vue";
import { installTitleTooltips } from "@tavora/official-ui/title-tooltips";
import App from "./App.vue";
import { setHintFloating } from "./host";

/** Mounts the app; throws the first error raised while mounting, with nothing left on screen. */
export function start(): void {
  const app = createApp(App);
  let failed: unknown;
  // Only while mounting: later errors go to Vue's default handling, a broken panel shouldn't replace the app.
  app.config.errorHandler = (error) => {
    failed ??= error;
  };
  app.mount("#app");
  app.config.errorHandler = undefined;
  if (failed !== undefined) {
    app.unmount();
    throw failed;
  }
  // Every title hint in the page shows as the shared kit tooltip instead of the system's small one.
  installTitleTooltips(document, { onOpenChange: setHintFloating });
}
