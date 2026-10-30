import { bootstrapModule, languageOf } from "@tavora/sdk/bootstrap";

// This page runs inside a Tavora panel; in a normal browser the connection fails. Build it and add this
// folder in Tavora (Settings > Project folders > Add folder) to see it.

const status = document.querySelector<HTMLParagraphElement>("#status")!;
const counter = document.querySelector<HTMLButtonElement>("#counter")!;

/** Your texts in English and German; Tavora says which language the user uses. */
const TEXTS = {
  en: { here: "You're in {workspace}.", clicked: "Clicked {count} times here." },
  de: { here: "Du bist in {workspace}.", clicked: "{count}-mal hier geklickt." },
};
let language: keyof typeof TEXTS = "en";
const text = (key: keyof (typeof TEXTS)["en"], params: Record<string, string | number>) =>
  TEXTS[language][key].replace(/{(w+)}/g, (match, name: string) => String(params[name] ?? match));

async function start() {
  // Connects, applies Tavora's theme as CSS variables (--background, --foreground, --primary, ...) and keeps
  // following it, so the module looks like Tavora.
  const tavora = await bootstrapModule();
  if (!tavora.sdk) {
    status.textContent = `Not connected to Tavora: ${tavora.error instanceof Error ? tavora.error.message : String(tavora.error)}`;
    return;
  }
  const sdk = tavora.sdk;
  language = languageOf(tavora.language);

  const workspace = await sdk.workspace.getCurrent();
  // storage keeps small settings for this module in the current workspace.
  let count = (await sdk.storage.get<number>("count")) ?? 0;
  const render = () => {
    status.textContent = `${text("here", { workspace: workspace.displayName })} ${text("clicked", { count })}`;
  };
  tavora.onLanguage((code) => {
    language = languageOf(code);
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

void start();
