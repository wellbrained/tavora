import {
  TavoraError,
  connect,
  type TavoraSDK,
  type TavoraTheme,
} from "@tavora/sdk";
import {
  getSkillName,
  getSkillDescription,
  getPointsUsed,
  getStatsFromSkills,
  BasicStats,
  getSkillsToRemove,
} from "../vendor/core";
import {
  SkillNodes,
  MAX_SKILL_POINTS_ABSOLUTE,
  readBuild,
  portable,
  validName,
  changeSkill,
  MAX_BUILD_BYTES,
  type Build,
} from "./model";
import { BuildRepository } from "./repository";
import { Tree, escape as esc } from "./tree";
import { english, german } from "./copy";
import "./style.css";
const $ = <T extends HTMLElement = HTMLElement>(s: string) =>
  document.querySelector<T>(s)!;
let sdk: TavoraSDK,
  repo: BuildRepository,
  tree: Tree,
  copy = english,
  build: Build | null = null,
  id: string | null = null,
  busy = false,
  inspected: string | null = null;
let loadRevision = 0;
let documentRevision = 0;
const root = $("#app");
const text = (value: string) => {
  const doc = new DOMParser().parseFromString(value, "text/html");
  return doc.body.textContent ?? "";
};
function status(message: string) {
  $("#status").textContent = message;
}
function error(e: unknown) {
  status(e instanceof Error ? e.message : String(e));
}
function theme(value: TavoraTheme) {
  for (const [key, val] of Object.entries(value.tokens))
    document.documentElement.style.setProperty("--" + key, val);
  for (const [key, val] of Object.entries(value.colors))
    document.documentElement.style.setProperty("--host-" + key, val);
}
function controls() {
  for (const control of document.querySelectorAll<
    HTMLButtonElement | HTMLSelectElement
  >(".toolbar button,.toolbar select,.details button"))
    control.disabled =
      busy || (!build && !["new", "import"].includes(control.id));
}
async function job(run: () => Promise<void>) {
  if (busy) return;
  busy = true;
  controls();
  try {
    await run();
  } catch (e) {
    if (e instanceof TavoraError && e.code === "CONFLICT" && id)
      await show(id).catch(() => {});
    error(e);
  } finally {
    busy = false;
    controls();
  }
}
async function library() {
  const entries = await repo.list();
  $("#build").innerHTML =
    '<option value="">' +
    esc(copy.build) +
    "</option>" +
    entries
      .sort((a, b) => a.title.localeCompare(b.title))
      .map(
        (item) =>
          '<option value="' + item.id + '">' + esc(item.title) + "</option>",
      )
      .join("");
  $<HTMLSelectElement>("#build").value = id ?? "";
}
async function show(next: string | null) {
  const ticket = ++loadRevision;
  const loaded = next ? await repo.get(next) : null;
  if (ticket !== loadRevision) return;
  build = loaded?.build ?? null;
  documentRevision = loaded?.revision ?? 0;
  id = next;
  inspected = null;
  await library();
  draw();
  await sdk.panel.setState({ build: id });
  await sdk.panel.setContent(build && id ? { id, title: build.name } : null);
}
function draw() {
  tree.render(build?.selection ?? {}, $<HTMLInputElement>("#search").value);
  const points = getPointsUsed(build?.selection ?? {});
  $("#points").textContent =
    points + " / " + MAX_SKILL_POINTS_ABSOLUTE + " " + copy.points;
  $("#remaining").textContent =
    MAX_SKILL_POINTS_ABSOLUTE - points + " " + copy.remaining;
  const stats = getStatsFromSkills(build?.selection ?? {});
  const de = [
    "Konstitution",
    "Stärke",
    "Ausdauer",
    "Geschick",
    "Geist",
    "Intelligenz",
  ];
  $("#stats").innerHTML = Object.entries(BasicStats)
    .map(
      ([key, value], i) =>
        "<div><dt>" +
        esc(copy === german ? de[i] : value.name) +
        "</dt><dd>+" +
        (stats[key as keyof typeof stats] ?? 0) +
        "</dd></div>",
    )
    .join("");
  $("#empty").hidden = !!build;
  details();
  controls();
}
function details() {
  if (!inspected) {
    $("#detail-content").innerHTML = "<p>" + esc(copy.ready) + "</p>";
    return;
  }
  const node = SkillNodes.nodes[inspected],
    meta = SkillNodes.types[node.type],
    level = build?.selection[inspected] ?? 0;
  $("#detail-content").innerHTML =
    "<h2>" +
    esc(getSkillName(node.type, "en")) +
    '</h2><p class="level">' +
    level +
    " / " +
    (meta.maxLevel ?? 1) +
    " · " +
    meta.cost +
    (copy === german ? " Punkte / Stufe</p>" : " points / level</p>") +
    getSkillDescription(node.type, "en", Math.max(1, level))
      .map((paragraph) => "<p>" + esc(text(paragraph)) + "</p>")
      .join("") +
    '<div class="detail-actions"><button id="allocate">' +
    esc(copy.allocate) +
    '</button><button id="refund">' +
    esc(copy.refund) +
    "</button></div>";
  $("#allocate").onclick = () => act(inspected!, false);
  $("#refund").onclick = () => act(inspected!, true);
  controls();
}
async function mutate(change: (build: Build) => Build) {
  if (!id) return;
  const target = id;
  const saved = await repo.update(target, change, documentRevision);
  build = saved.build;
  documentRevision = saved.revision;
  draw();
  await library();
  await sdk.panel.setContent({ id: target, title: build.name });
  status(copy.saved);
}
function act(nodeId: string, refund: boolean) {
  if (!build) return;
  const level = build.selection[nodeId] ?? 0,
    max = SkillNodes.types[SkillNodes.nodes[nodeId].type].maxLevel ?? 1;
  const removes = (refund && level === 1) || (!refund && level === max);
  const affected = removes
    ? getSkillsToRemove(nodeId, Object.keys(build.selection))
    : [];
  if (affected.length > 1) {
    void ask(
      copy === german
        ? "Verbundene Fertigkeiten erstatten?"
        : "Refund connected skills?",
      affected
        .map((id) => getSkillName(SkillNodes.nodes[id].type, "en"))
        .join(", "),
      copy.refund,
    ).then((ok) => {
      if (ok)
        void job(() =>
          mutate((current) =>
            changeSkill(current, nodeId, refund ? "secondary" : "primary"),
          ),
        );
    });
    return;
  }
  void job(() =>
    mutate((current) =>
      changeSkill(current, nodeId, refund ? "secondary" : "primary"),
    ),
  );
}
function dialog(title: string, body: string, yes: string, field?: string) {
  const panel = $<HTMLDialogElement>("#dialog");
  $("#dialog-title").textContent = title;
  $("#dialog-body").textContent = body;
  $("#dialog-yes").textContent = yes;
  $("#name-field").hidden = field === undefined;
  const input = $<HTMLInputElement>("#name");
  input.value = field ?? "";
  input.required = field !== undefined;
  $("#dialog-error").textContent = "";
  panel.showModal();
  if (field !== undefined) {
    input.focus();
    input.select();
  }
  return new Promise<string | null>((resolve) => {
    const form = $<HTMLFormElement>("#dialog-form");
    form.onsubmit = (e) => {
      e.preventDefault();
      try {
        const value = field === undefined ? "yes" : validName(input.value);
        panel.close();
        resolve(value);
      } catch (e) {
        $("#dialog-error").textContent =
          e instanceof Error ? e.message : String(e);
      }
    };
    $("#dialog-cancel").onclick = () => {
      panel.close();
      resolve(null);
    };
    panel.oncancel = () => resolve(null);
  });
}
async function ask(title: string, body: string, yes: string) {
  return (await dialog(title, body, yes)) !== null;
}
async function nameBuild(rename = false) {
  const target = id;
  const name = await dialog(
    rename ? copy.rename : copy.new,
    "",
    copy.save,
    rename ? (build?.name ?? "") : copy === german ? "Mein Build" : "My build",
  );
  if (name === null) return;
  await job(async () => {
    if (rename && target === id && id) {
      await mutate((current) => ({ ...current, name }));
    } else if (!rename) {
      const next = await repo.create({ name, selection: {} });
      await show(next);
      status(copy.saved);
    }
  });
}
function setup() {
  root.innerHTML =
    '<header class="toolbar"><button id="new">' +
    esc(copy.new) +
    '</button><select id="build" aria-label="' +
    esc(copy.build) +
    '"></select><button id="rename">' +
    esc(copy.rename) +
    '</button><button id="import">' +
    esc(copy.import) +
    '</button><button id="export">' +
    esc(copy.export) +
    '</button><button id="reset">' +
    esc(copy.reset) +
    '</button></header><section class="summary"><strong id="points"></strong><span id="remaining"></span><span class="version">' +
    esc(copy.version) +
    '</span></section><main><section class="tree-area"><div class="tree-toolbar"><input id="search" type="search" maxlength="100" placeholder="' +
    esc(copy.search) +
    '" aria-label="' +
    esc(copy.search) +
    '"><button id="fit">' +
    esc(copy.fit) +
    '</button><button id="zoom-out" aria-label="Zoom out">−</button><button id="zoom-in" aria-label="Zoom in">+</button></div><svg id="tree" aria-label="Enshrouded 1.0 skill tree" tabindex="0" preserveAspectRatio="xMidYMid meet"></svg><div id="empty"><p>' +
    esc(copy.empty) +
    '</p><button id="empty-new">' +
    esc(copy.new) +
    '</button></div><p class="tree-hint">' +
    esc(copy.hint) +
    '</p></section><aside class="details"><h1>' +
    esc(copy.details) +
    '</h1><div id="detail-content"></div><section class="attributes"><h2>' +
    esc(copy.stats) +
    '</h2><dl id="stats"></dl><p>' +
    esc(copy.statsHint) +
    "</p></section>" +
    (copy === german ? "<p>" + esc(copy.skillLanguage) + "</p>" : "") +
    '</aside></main><footer id="status" role="status" aria-live="polite"></footer><input id="file" type="file" accept=".json,application/json" hidden><dialog id="dialog"><form id="dialog-form"><h2 id="dialog-title"></h2><p id="dialog-body"></p><label id="name-field">' +
    esc(copy.name) +
    '<input id="name" maxlength="100" required></label><p id="dialog-error" role="alert"></p><div class="dialog-actions"><button id="dialog-cancel" type="button">' +
    esc(copy.cancel) +
    '</button><button id="dialog-yes" type="submit">' +
    esc(copy.save) +
    "</button></div></form></dialog>";
  tree = new Tree(
    $<SVGSVGElement & HTMLElement>("#tree"),
    (node) => {
      inspected = node;
      details();
    },
    act,
  );
  $("#new").onclick = () => void nameBuild();
  $("#empty-new").onclick = () => void nameBuild();
  $("#rename").onclick = () => void nameBuild(true);
  $("#build").onchange = () =>
    void job(() => show($<HTMLSelectElement>("#build").value || null));
  $("#fit").onclick = () => tree.fit();
  $("#zoom-in").onclick = () => tree.zoom(1 / 1.25);
  $("#zoom-out").onclick = () => tree.zoom(1.25);
  $("#search").oninput = () => {
    const query = $<HTMLInputElement>("#search").value;
    tree.render(build?.selection ?? {}, query);
    const matches = Object.values(SkillNodes.nodes).filter((node) =>
      getSkillName(node.type, "en")
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
    );
    if (query.trim())
      status(matches.length + " " + (copy === german ? "Treffer" : "matches"));
  };
  $("#search").onkeydown = (e) => {
    if (e.key === "Enter") {
      const query = $<HTMLInputElement>("#search").value.trim().toLowerCase();
      const node = Object.values(SkillNodes.nodes).find((node) =>
        getSkillName(node.type, "en").toLowerCase().includes(query),
      );
      if (node) tree.focus(node.id);
    }
  };
  $("#reset").onclick = () => {
    void ask(copy.resetAsk, "", copy.resetYes).then((ok) => {
      if (ok)
        void job(() => mutate((current) => ({ ...current, selection: {} })));
    });
  };
  $("#export").onclick = () => {
    if (!build) return;
    const snapshot = portable(build);
    void job(async () => {
      const result = await sdk.files.exportJson(snapshot, build!.name);
      status(
        (copy === german
          ? "Gespeichert in Downloads/Tavora: "
          : "Saved in Downloads/Tavora: ") + result.fileName,
      );
    });
  };
  $("#import").onclick = () => $("#file").click();
  $("#file").onchange = () => {
    const input = $<HTMLInputElement>("#file"),
      file = input.files?.[0];
    input.value = "";
    if (!file) return;
    void job(async () => {
      if (file.size > MAX_BUILD_BYTES)
        throw Error("Choose a JSON file up to 256 KB.");
      const raw = JSON.parse(await file.text());
      const imported = readBuild(raw);
      const notice = raw.treeContentHash ? "" : copy.unversioned;
      const answer = await dialog(
        copy.importTitle,
        notice +
          " " +
          getPointsUsed(imported.selection) +
          " / " +
          MAX_SKILL_POINTS_ABSOLUTE +
          " " +
          copy.points,
        copy.importYes,
        imported.name,
      );
      if (answer === null) return;
      const next = await repo.create({ ...imported, name: answer });
      await show(next);
      status(copy.saved);
    });
  };
}
async function start() {
  sdk = await connect();
  repo = new BuildRepository(sdk);
  const language = await sdk.ui.getLanguage();
  copy = language.startsWith("de") ? german : english;
  document.documentElement.lang = copy === german ? "de" : "en";
  theme(await sdk.ui.getTheme());
  sdk.ui.onThemeChange(theme);
  setup();
  const launch = await sdk.panel.getLaunch();
  const state = await sdk.panel.getState<{ build?: string }>();
  const first =
    (launch.reason === "add" ? null : launch.content?.id) ??
    state?.build ??
    null;
  try {
    await show(first);
  } catch (e) {
    await show(null);
    error(e);
  }
  sdk.documents.onChange((change) => {
    if (!change.id.startsWith("enshrouded-")) return;
    if (busy || $<HTMLDialogElement>("#dialog").open) return;
    void (async () => {
      if (change.id === id) await show(id);
      else await library();
    })().catch(error);
  });
  sdk.panel.onNavigate((content) => job(() => show(content.id)));
  sdk.ui.onLanguageChange(() =>
    status(
      copy === german
        ? "Öffne das Panel erneut, um die Sprache zu wechseln."
        : "Reopen this panel to change language.",
    ),
  );
}
void start().catch((e) => {
  root.textContent =
    "Open this module in Tavora. " +
    (e instanceof Error ? e.message : String(e));
});
