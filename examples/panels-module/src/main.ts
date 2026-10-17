import { connect, type DocumentSummary, type PanelLaunch, type TavoraSDK, type TavoraTheme } from "@tavora/sdk";
import manifest from "../tavora.module.json";

// A showcase of named panel types: each page asks Tavora which type it runs
// as and shows the options that type takes from the manifest. Each panel also
// picks a build of its own and tells Tavora about it. It does no real work; it
// is here to show what a module with several panels can declare and do.

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

/** Builds every panel can pick from. They are documents, so they are shared and each panel hears about changes. */
const SAMPLE_BUILDS = [
  { id: "ice-shot", title: "0.5 Ice Shot Deadeye Leveling Guide" },
  { id: "lightning-arrow", title: "Lightning Arrow Invoker" },
  { id: "minion-witch", title: "Minion Witch for maps" },
];

function describeLaunch(launch: PanelLaunch): string {
  if (launch.reason === "add") return "add: the player just added this panel, so it picked the build used last";
  return launch.content ? `restore: it was open before and showed "${launch.content.title}"` : "restore: it was open before and showed nothing";
}

/** The content selector in the toolbar: one build per panel, kept with the panel and told to Tavora. */
async function contentSelector(tavora: TavoraSDK) {
  const select = el<HTMLSelectElement>("content-select");
  const remove = el<HTMLButtonElement>("delete-content");
  // Fixed ids, so two panels adding them at once still make three builds.
  if ((await tavora.documents.list()).length === 0) {
    for (const build of SAMPLE_BUILDS) await tavora.documents.put({ ...build, data: { notes: "" } });
  }
  let builds: DocumentSummary[] = [];
  let selected: string | null = null;
  const load = async () => {
    builds = (await tavora.documents.list()).sort((a, b) => a.title.localeCompare(b.title));
  };

  const show = async () => {
    const build = builds.find((item) => item.id === selected);
    select.replaceChildren(
      ...(build ? [] : [new Option("Pick a build", "", true, true)]),
      ...builds.map((item) => new Option(item.title, item.id, false, item.id === selected)),
    );
    select.title = build?.title ?? "";
    select.disabled = builds.length === 0;
    remove.disabled = !build;
    // Deleted content leaves the panel open with a note, never another build in its place.
    el("content-gone").hidden = build !== undefined || selected === null;
    await tavora.panel.setContent(build ? { id: build.id, title: build.title } : null);
  };
  const pick = async (id: string | null) => {
    selected = id;
    await tavora.panel.setState(id === null ? null : { build: id });
    if (id !== null) await tavora.storage.set("lastUsed", id);
    await show();
  };

  await load();
  const launch = await tavora.panel.getLaunch();
  el("launch").textContent = describeLaunch(launch);
  if (launch.reason === "add") {
    // A fresh panel: the build used last, else the first one.
    const last = await tavora.storage.get<string>("lastUsed");
    await pick(builds.some((item) => item.id === last) ? last : (builds[0]?.id ?? null));
  } else {
    // Open before: the panel's own choice, kept in its panel state.
    selected = (await tavora.panel.getState<{ build: string }>())?.build ?? launch.content?.id ?? null;
    await show();
  }

  select.addEventListener("change", () => void pick(select.value || null));
  remove.addEventListener("click", async () => {
    if (selected === null) return;
    await tavora.documents.delete(selected);
    await load();
    await show();
  });
  tavora.documents.onChange(async () => {
    await load();
    await show();
  });
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

  await contentSelector(tavora);
}

main().catch((error: unknown) => {
  el("panel-type").textContent = "Could not connect to Tavora";
  console.error(error);
});
