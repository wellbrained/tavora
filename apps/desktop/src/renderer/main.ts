import "./styles.css";
import "./dock.css";

// The app is loaded on its own, so an error while it loads or mounts shows on the error screen, not a black window.
try {
  const { start } = await import("./start");
  start();
} catch (error) {
  console.error(error);
  await showStartupError(error);
}

async function showStartupError(error: unknown): Promise<void> {
  const detail = error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error);
  try {
    const [{ createApp, h }, { default: StartupError }] = await Promise.all([import("vue"), import("./components/StartupError.vue")]);
    document.getElementById("app")!.replaceChildren();
    createApp({ render: () => h(StartupError, { detail }) }).mount("#app");
  } catch {
    // Even the error screen didn't load: the plain text still tells what happened.
    const text = document.createElement("pre");
    text.style.cssText = "margin:0;padding:64px 32px;white-space:pre-wrap;font:13px monospace;color:#f2ece0;user-select:text";
    text.textContent = `Tavora couldn't start.\n\n${detail}`;
    document.getElementById("app")!.replaceChildren(text);
  }
}
