// Nothing is imported up here, not even the styles: whatever fails to load or start shows on the error screen,
// not as a black window.
export {};

type Reason = "error" | "noAnswer" | "crashed";

// The main process loads the page with ?crashed= when it crashed twice in a row (registerWindowEvents in main/host.ts).
const crashed = new URLSearchParams(location.search).get("crashed");
if (crashed !== null) {
  await showStartupError("crashed", `The Tavora window crashed twice in a row: ${crashed}`);
} else {
  try {
    const { start } = await import("./start");
    await start();
  } catch (error) {
    console.error(error);
    const detail = error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error);
    await showStartupError(error instanceof Error && error.name === "NoAnswerError" ? "noAnswer" : "error", detail);
  }
}

async function showStartupError(reason: Reason, detail: string): Promise<void> {
  try {
    const [{ createApp, h }, { default: StartupError }] = await Promise.all([import("vue"), import("./components/StartupError.vue")]);
    createApp({ render: () => h(StartupError, { reason, detail }) }).mount(freshRoot());
  } catch {
    // Even the error screen didn't load: the plain text still tells what happened.
    const text = document.createElement("pre");
    text.style.cssText = "margin:0;padding:64px 32px;white-space:pre-wrap;font:13px monospace;color:#f2ece0;user-select:text";
    text.textContent = `Tavora couldn't start.\n\n${detail}`;
    freshRoot().append(text);
  }
}

/** A new, empty #app in place of the old one, which a half-drawn app may still hold on to. */
function freshRoot(): HTMLElement {
  const root = document.createElement("div");
  root.id = "app";
  document.getElementById("app")!.replaceWith(root);
  return root;
}
