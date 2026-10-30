import { bootstrapModule, languageOf } from "@tavora/sdk/bootstrap";
import type { TavoraSDK } from "@tavora/sdk";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

// This page runs inside a Tavora panel; in a normal browser the connection fails. Build it and add this
// folder in Tavora (Settings > Project folders > Add folder) to see it.

/** Your texts in English and German; Tavora says which language the user uses. */
const TEXTS = {
  en: { connecting: "Connecting to Tavora…", here: "You're in {workspace}.", clicked: "Clicked {count} times here." },
  de: { connecting: "Verbinde mit Tavora …", here: "Du bist in {workspace}.", clicked: "{count}-mal hier geklickt." },
};
type Language = keyof typeof TEXTS;
const text = (language: Language, key: keyof (typeof TEXTS)["en"], params: Record<string, string | number> = {}) =>
  TEXTS[language][key].replace(/{(w+)}/g, (match, name: string) => String(params[name] ?? match));

function App() {
  const [tavora, setTavora] = useState<TavoraSDK | null>(null);
  const [language, setLanguage] = useState<Language>("en");
  const [workspace, setWorkspace] = useState("");
  const [count, setCount] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let stop = () => {};
    // Connects, applies Tavora's theme as CSS variables (--background, --foreground, --primary, ...) and keeps
    // following it, so the module looks like Tavora.
    bootstrapModule().then(async (boot) => {
      if (cancelled) return boot.dispose();
      stop = boot.dispose;
      const sdk = boot.sdk;
      if (!sdk) return setFailed(`Not connected to Tavora: ${boot.error instanceof Error ? boot.error.message : String(boot.error)}`);
      setLanguage(languageOf(boot.language));
      boot.onLanguage((code) => setLanguage(languageOf(code)));
      setWorkspace((await sdk.workspace.getCurrent()).displayName);
      // storage keeps small settings for this module in the current workspace.
      setCount((await sdk.storage.get<number>("count")) ?? 0);
      setTavora(sdk);
    });
    return () => {
      cancelled = true;
      stop();
    };
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
