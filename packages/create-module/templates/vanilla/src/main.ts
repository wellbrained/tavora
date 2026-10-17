import { connect, type TavoraSDK, type TavoraTheme } from "@tavora/sdk";

// This page runs inside a Tavora panel; in a normal browser connect() fails. Build it and add this
// folder in Tavora (Settings > Development > Add a development folder) to see it.

const status = document.querySelector<HTMLParagraphElement>("#status")!;
const counter = document.querySelector<HTMLButtonElement>("#counter")!;

/** Your texts in English and German; Tavora says which language the player uses. */
const TEXTS = {
  en: { playing: "Playing {game}.", clicked: "Clicked {count} times in this game." },
  de: { playing: "Du spielst {game}.", clicked: "{count}-mal in diesem Spiel geklickt." },
};
let language: keyof typeof TEXTS = "en";
const text = (key: keyof (typeof TEXTS)["en"], params: Record<string, string | number>) =>
  TEXTS[language][key].replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match));

/** Tavora's theme as CSS variables (--background, --foreground, --primary, ...), so the module looks like Tavora. */
function applyTheme(theme: TavoraTheme) {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(theme.tokens)) root.style.setProperty(`--${name}`, value);
  root.style.setProperty("--radius", `${theme.radius}px`);
  root.style.colorScheme = theme.mode;
}

async function start(tavora: TavoraSDK) {
  applyTheme(await tavora.ui.getTheme());
  tavora.ui.onThemeChange(applyTheme);
  const setLanguage = (code: string) => (language = code.startsWith("de") ? "de" : "en");
  setLanguage(await tavora.ui.getLanguage());

  const game = await tavora.game.getCurrent();
  // storage keeps small settings for this module in the current game.
  let count = (await tavora.storage.get<number>("count")) ?? 0;
  const render = () => {
    status.textContent = `${text("playing", { game: game.displayName })} ${text("clicked", { count })}`;
  };
  tavora.ui.onLanguageChange((code) => {
    setLanguage(code);
    render();
  });
  render();

  counter.disabled = false;
  counter.addEventListener("click", async () => {
    count += 1;
    render();
    await tavora.storage.set("count", count);
  });
}

connect().then(start, (error: unknown) => {
  status.textContent = `Not connected to Tavora: ${error instanceof Error ? error.message : String(error)}`;
});
