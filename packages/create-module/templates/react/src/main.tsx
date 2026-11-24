import { bootstrapModule, languageOf } from "@tavora/sdk/bootstrap";
import type { TavoraSDK } from "@tavora/sdk";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { text, type Language } from "./texts";

// This page runs inside a Tavora panel; in a normal browser the connection fails. Build it and add this
// folder in Tavora (Settings > Developer > Project folders > Add folder) to see it.

function App() {
  const [tavora, setTavora] = useState<TavoraSDK | null>(null);
  const [language, setLanguage] = useState<Language>(languageOf(navigator.language));
  const [workspace, setWorkspace] = useState("");
  const [count, setCount] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    let cancelled = false;
    let stop = () => {};
    // Connects, applies Tavora's theme as CSS variables (--background, --foreground, --primary, ...) and keeps
    // following it, so the module looks like Tavora.
    const start = async () => {
      const boot = await bootstrapModule();
      if (cancelled) return boot.dispose();
      stop = boot.dispose;
      const sdk = boot.sdk;
      if (!sdk) throw boot.error;
      setLanguage(languageOf(boot.language));
      boot.onLanguage((code) => setLanguage(languageOf(code)));
      setWorkspace((await sdk.workspace.getCurrent()).displayName);
      // storage keeps small settings for this module in the current workspace.
      setCount((await sdk.storage.get<number>("count")) ?? 0);
      if (!cancelled) setTavora(sdk);
    };
    start().catch((error: unknown) => {
      console.error("Not connected to Tavora", error);
      if (!cancelled) setFailed(true);
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

  const status = failed ? text(language, "notConnected") : tavora ? text(language, "status", { workspace, count }) : text(language, "connecting");
  return (
    <main>
      <h1>{document.title}</h1>
      <p id="status">{status}</p>
      <button type="button" disabled={!tavora} onClick={add}>
        {text(language, "add")}
      </button>
    </main>
  );
}

createRoot(document.getElementById("app")!).render(<App />);
