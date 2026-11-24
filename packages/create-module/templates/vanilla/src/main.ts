import { bootstrapModule, languageOf } from "@tavora/sdk/bootstrap";
import { text, type Language } from "./texts";

// This page runs inside a Tavora panel; in a normal browser the connection fails. Build it and add this
// folder in Tavora (Settings > Developer > Project folders > Add folder) to see it.

const status = document.querySelector<HTMLParagraphElement>("#status")!;
const counter = document.querySelector<HTMLButtonElement>("#counter")!;

let language: Language = languageOf(navigator.language);
/** Shows the texts in `next`, and tells the browser which language the page is in. */
const useLanguage = (next: Language) => {
  language = next;
  document.documentElement.lang = next;
  counter.textContent = text(language, "add");
};
useLanguage(language);
status.textContent = text(language, "connecting");

async function start() {
  // Connects, applies Tavora's theme as CSS variables (--background, --foreground, --primary, ...) and keeps
  // following it, so the module looks like Tavora.
  const tavora = await bootstrapModule();
  if (!tavora.sdk) {
    console.error("Not connected to Tavora", tavora.error);
    status.textContent = text(language, "notConnected");
    return;
  }
  const sdk = tavora.sdk;
  useLanguage(languageOf(tavora.language));

  const workspace = await sdk.workspace.getCurrent();
  // storage keeps small settings for this module in the current workspace.
  let count = (await sdk.storage.get<number>("count")) ?? 0;
  const render = () => {
    status.textContent = text(language, "status", { workspace: workspace.displayName, count });
  };
  tavora.onLanguage((code) => {
    useLanguage(languageOf(code));
    render();
  });
  render();

  counter.disabled = false;
  counter.addEventListener("click", async () => {
    count += 1;
    render();
    await sdk.storage.set("count", count);
  });
}

start().catch((error: unknown) => {
  console.error(error);
  status.textContent = text(language, "notConnected");
});
