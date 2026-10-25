// Mounts the host UI. main.ts loads this on its own, so a module that throws while loading
// (0.20.33 opened to a black window) ends up on the error screen instead.
import "./styles.css";
import "./dock.css";
import { createApp, nextTick, watch } from "vue";
import { installTitleTooltips } from "@tavora/official-ui/title-tooltips";
import App from "./App.vue";
import { firstState, setHintFloating, state } from "./host";

/** How long the first state may take; the main process answers at once when it is well. */
const NO_ANSWER_MS = 15_000;

/** The main process never sent the app's state. */
export class NoAnswerError extends Error {
  override name = "NoAnswerError";
}

/**
 * Mounts the app and resolves once it has drawn the first state. Rejects with the first error raised until
 * then, with nothing left on screen: the state comes after mounting, so the first real render does too.
 */
export function start(): Promise<void> {
  return new Promise((resolve, reject) => {
    const app = createApp(App);
    let mounting = true;
    let failed: { error: unknown } | undefined;
    let settled = false;
    let stopWatching = () => {};
    const settle = () => {
      settled = true;
      clearTimeout(timer);
      stopWatching();
      // From here on errors go to Vue's default handling: a broken panel shouldn't replace the app.
      app.config.errorHandler = undefined;
    };
    const fail = (error: unknown) => {
      if (settled) return;
      // Unmounting in the middle of a mount breaks Vue; mount() ends first, then this runs again.
      if (mounting) return void (failed ??= { error });
      settle();
      // A half-drawn app may keep failing while it goes; those errors are only logged, under the error screen.
      app.config.errorHandler = (later) => console.error(later);
      try {
        app.unmount();
      } catch {
        // It may not unmount cleanly either; main.ts swaps in a fresh element for the error screen.
      }
      reject(error);
    };
    const timer = setTimeout(() => fail(new NoAnswerError(`No state from the main process after ${NO_ANSWER_MS / 1000} s`)), NO_ANSWER_MS);
    app.config.errorHandler = fail;
    firstState.catch(fail);

    app.mount("#app");
    mounting = false;
    if (failed) return fail(failed.error);

    // A post watcher runs after the components have drawn the state; an error on the way has called fail first.
    stopWatching = watch(
      state,
      (next) => {
        if (!next) return;
        void nextTick(() => {
          if (settled) return;
          settle();
          // Every title hint in the page shows as the shared kit tooltip instead of the system's small one.
          installTitleTooltips(document, { onOpenChange: setHintFloating });
          resolve();
        });
      },
      { immediate: true, flush: "post" },
    );
  });
}
