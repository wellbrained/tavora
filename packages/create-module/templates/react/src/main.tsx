import { connect, type TavoraSDK, type TavoraTheme } from "@tavora/sdk";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

// This page runs inside a Tavora panel; in a normal browser connect() fails. Build it and add this
// folder in Tavora (Settings > Development > Add a development folder) to see it.

/** Your texts in English and German; Tavora says which language the player uses. */
const TEXTS = {
  en: { connecting: "Connecting to Tavora…", here: "You're in {workspace}.", clicked: "Clicked {count} times here." },
  de: { connecting: "Verbinde mit Tavora …", here: "Du bist in {workspace}.", clicked: "{count}-mal hier geklickt." },
};
type Language = keyof typeof TEXTS;
const text = (language: Language, key: keyof (typeof TEXTS)["en"], params: Record<string, string | number> = {}) =>
  TEXTS[language][key].replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match));

/** Tavora's theme as CSS variables (--background, --foreground, --primary, ...), so the module looks like Tavora. */
function applyTheme(theme: TavoraTheme) {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(theme.tokens)) root.style.setProperty(`--${name}`, value);
  root.style.setProperty("--radius", `${theme.radius}px`);
  root.style.colorScheme = theme.mode;
}

function App() {
  const [tavora, setTavora] = useState<TavoraSDK | null>(null);
  const [language, setLanguage] = useState<Language>("en");
  const [workspace, setWorkspace] = useState("");
  const [count, setCount] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    const pick = (code: string): Language => (code.startsWith("de") ? "de" : "en");
    connect().then(
      async (sdk) => {
        applyTheme(await sdk.ui.getTheme());
        sdk.ui.onThemeChange(applyTheme);
        setLanguage(pick(await sdk.ui.getLanguage()));
        sdk.ui.onLanguageChange((code) => setLanguage(pick(code)));
        setWorkspace((await sdk.workspace.getCurrent()).displayName);
        // storage keeps small settings for this module in the current workspace.
        setCount((await sdk.storage.get<number>("count")) ?? 0);
        setTavora(sdk);
      },
      (error: unknown) => setFailed(`Not connected to Tavora: ${error instanceof Error ? error.message : String(error)}`),
    );
  }, []);

  const add = () => {
    const next = count + 1;
    setCount(next);
    void tavora?.storage.set("count", next);
  };

  const status = failed ?? (tavora ? `${text(language, "here", { workspace })} ${text(language, "clicked", { count })}` : text(language, "connecting"));
  return (
    <main>
      <h1>{document.title}</h1>
      <p id="status">{status}</p>
      <button type="button" disabled={!tavora} onClick={add}>
        +1
      </button>
    </main>
  );
}

createRoot(document.getElementById("app")!).render(<App />);
