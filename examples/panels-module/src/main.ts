import { connect, type TavoraTheme } from "@tavora/sdk";
import manifest from "../tavora.module.json";

// A showcase of named panel types: each page asks Tavora which type it runs
// as and shows the options that type takes from the manifest. It does no real
// work; it is here to show what a module with several panels can declare.

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.querySelector<T>(`[data-testid="${id}"]`)!;

type PanelType = (typeof manifest.panels)[number] & { entry?: string; icon?: string; viewport?: object; continues?: boolean };

/** What each option means, in the words the manifest reference uses. */
const OPTIONS: [keyof PanelType, string, (type: PanelType) => string][] = [
  ["id", "Stable identity, never shown; saved layouts keep it", (type) => type.id],
  ["name", "Short name on the tab", (type) => type.name],
  ["entry", "Its own page", (type) => type.entry ?? `not set: the module's ${manifest.entry}`],
  ["icon", "Its own tab icon", (type) => type.icon ?? `not set: the module's ${manifest.icon}`],
  ["viewport", "Its own sizes", (type) => (type.viewport ? JSON.stringify(type.viewport) : "not set: the module's viewport")],
  ["continues", "Panels from before the module had types become this one", (type) => (type.continues ? "yes" : "no")],
];

function applyTheme(theme: TavoraTheme) {
  const style = document.documentElement.style;
  style.setProperty("--bg", theme.colors.background);
  style.setProperty("--text", theme.colors.text);
  style.setProperty("--muted", theme.colors.textMuted);
  style.setProperty("--accent", theme.colors.accent);
}

function render(typeId: string | null) {
  const types = manifest.panels as PanelType[];
  const type = types.find((item) => item.id === typeId);
  el("panel-type").textContent = type ? type.name : "No panel type";
  el("summary").textContent = type
    ? `tavora.panel.type is "${type.id}". Tavora loaded ${type.entry ?? manifest.entry} for it.`
    : "This Tavora sent no panel type; it is older than 0.17.12.";

  const options = el("options");
  options.replaceChildren();
  if (type) {
    for (const [key, meaning, value] of OPTIONS) {
      const term = document.createElement("dt");
      term.textContent = `${key}: ${meaning}`;
      const detail = document.createElement("dd");
      detail.textContent = value(type);
      if (type[key] === undefined) detail.classList.add("default");
      options.append(term, detail);
    }
  }

  el("types").replaceChildren(
    ...types.map((item) => {
      const li = document.createElement("li");
      li.textContent = `${item.name} (${item.id})${item.id === typeId ? ", this panel" : ""}`;
      return li;
    }),
  );
}

async function main() {
  const tavora = await connect();
  render(tavora.panel.type);
  applyTheme(await tavora.ui.getTheme());
  tavora.ui.onThemeChange(applyTheme);

  // A setting every panel type reads and writes: content is shared, not per panel.
  let shared = (await tavora.storage.get<number>("shared")) ?? 0;
  el("shared").textContent = String(shared);
  const bump = el<HTMLButtonElement>("bump");
  bump.disabled = false;
  bump.addEventListener("click", async () => {
    shared += 1;
    el("shared").textContent = String(shared);
    await tavora.storage.set("shared", shared);
  });
}

main().catch((error: unknown) => {
  el("panel-type").textContent = "Could not connect to Tavora";
  console.error(error);
});
