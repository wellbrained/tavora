// @vitest-environment jsdom
// Add a game and the empty game page: a click picks what the user saw, the keys keep working after a click anywhere in
// the dialog (and in the welcome's game step), a game added since the list was found opens instead of being added again, the covers' art is asked for
// once, and "Made for" loads, fails and waits in place. The host is a fake whose answers the test gives.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, ref, type App, type Component } from "vue";
import type { CatalogModuleView, InstalledGameView, WorkspaceView } from "../../shared/host-api";
import type { PickerLine, PickerRow } from "../lib/game-picker";

const host = vi.hoisted(() => ({
  act: vi.fn(),
  api: {
    browseCatalog: vi.fn(),
    catalogForGames: vi.fn(),
    catalogIcon: vi.fn(),
    gameCovers: vi.fn(),
    installedGames: vi.fn(),
    popularGames: vi.fn(),
    searchCatalog: vi.fn(),
    searchOnline: vi.fn(),
  },
  closeDialog: vi.fn(),
  listOf: (items: string[]) => items.join(", "),
  openPanels: vi.fn(),
  installProgress: {},
}));
const hostState = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("../host", async () => {
  const { ref } = await import("vue");
  const state = ref({ modules: [], library: { workspaces: {}, onboarded: true, askedModules: [] } });
  hostState.value = state;
  return { ...host, dialog: ref({ kind: "add-game" }), state };
});
// Plain frames in place of the kit's dialog, so the test needs no portals; listeners go to the frame.
vi.mock("@tavora/official-ui/components/ui/dialog", async () => {
  const { defineComponent, h } = await import("vue");
  const frame = (tag: string) => defineComponent({ inheritAttrs: true, setup: (_, { slots }) => () => h(tag, slots.default?.()) });
  return { Dialog: frame("div"), DialogContent: frame("section"), DialogTitle: frame("h2"), DialogDescription: frame("p") };
});
vi.mock("./CatalogIcon.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return { default: defineComponent({ setup: () => () => h("span") }) };
});

import AddGameDialog from "./AddGameDialog.vue";
import GamePickerList from "./GamePickerList.vue";
import MadeForGame from "./workspace/MadeForGame.vue";
import OnboardingGame from "./onboarding/OnboardingGame.vue";
import { resetInstalledGames } from "../lib/installed-games";
import { useCoverArt } from "../lib/use-game-picker";

const state = () => hostState.value as { value: { modules: { id: string }[]; library: { workspaces: Record<string, WorkspaceView>; onboarded: boolean; askedModules: string[] } } };
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const settle = async () => {
  for (let i = 0; i < 4; i++) await tick();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((ok) => (resolve = ok));
  return { promise, resolve };
}

let app: App | undefined;
let root: HTMLElement;
beforeEach(() => {
  for (const fn of [host.act, host.closeDialog, host.openPanels, ...Object.values(host.api)]) fn.mockReset();
  host.api.catalogForGames.mockResolvedValue({ status: "ok", modules: [] });
  host.api.searchCatalog.mockResolvedValue([]);
  host.api.searchOnline.mockResolvedValue({ status: "ok", games: [] });
  host.api.gameCovers.mockResolvedValue({});
  host.api.installedGames.mockResolvedValue([]);
  host.api.popularGames.mockResolvedValue([]);
  state().value = { modules: [], library: { workspaces: {}, onboarded: true, askedModules: [] } };
  resetInstalledGames();
  // jsdom has no layout: keeping the highlight in view does nothing here.
  Element.prototype.scrollIntoView = () => {};
  root = document.createElement("div");
  document.body.append(root);
});
afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = "";
});

function mount(component: Component, props: () => Record<string, unknown> = () => ({})) {
  app = createApp({ render: () => h(component, props()) });
  app.mount(root);
}
const $ = (id: string) => root.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const move = (element: Element, x: number) => element.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, screenX: x, screenY: 10 }));
const click = (element: Element) => element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));

const game = (name: string, extra: Partial<InstalledGameView> = {}): InstalledGameView => ({
  key: `n:${name.toLowerCase()}`,
  name,
  steamAppId: null,
  catalogId: null,
  icon: null,
  activity: null,
  workspaceId: null,
  ...extra,
});
const row = (name: string): PickerRow => ({ key: name, name, gameId: name, icon: null, installed: null, online: null, workspaceId: null, section: "catalog" });

describe("GamePickerList: a click picks what the user saw", () => {
  it("picks the row clicked, but when the rows moved under a still pointer the first click only highlights", async () => {
    const lines = ref<PickerLine[]>(["Alpha", "Beta"].map((name) => ({ key: name, row: row(name) })));
    const hover = vi.fn();
    const pick = vi.fn();
    mount(GamePickerList, () => ({ id: "list", label: "Games", lines: lines.value, active: null, custom: null, typed: true, info: () => ({ modules: 0, when: null }), onHover: hover, onPick: pick }));
    move($("catalog-Beta")!, 5);
    click($("catalog-Beta")!);
    expect(pick).toHaveBeenLastCalledWith("Beta");

    // A late answer puts Gamma where the pointer is; the browser's move at the same place is not the user's.
    lines.value = [{ key: "Alpha", row: row("Alpha") }, { key: "Gamma", row: row("Gamma") }, { key: "Beta", row: row("Beta") }];
    await nextTick();
    move($("catalog-Gamma")!, 5);
    click($("catalog-Gamma")!);
    expect(pick).toHaveBeenCalledTimes(1);
    expect(hover).toHaveBeenLastCalledWith("Gamma");
    click($("catalog-Gamma")!);
    expect(pick).toHaveBeenLastCalledWith("Gamma");

    // After a real move the click picks at once again, and so does a click from the keyboard (detail 0).
    lines.value = [...lines.value, { key: "Delta", row: row("Delta") }];
    await nextTick();
    $("catalog-Delta")!.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    expect(pick).toHaveBeenLastCalledWith("Delta");
  });

  it("picks at once when rows come in below the one the pointer rests on", async () => {
    const lines = ref<PickerLine[]>(["Elden Ring"].map((name) => ({ key: name, row: row(name) })));
    const hover = vi.fn();
    const pick = vi.fn();
    mount(GamePickerList, () => ({ id: "list", label: "Games", lines: lines.value, active: "Elden Ring", custom: null, typed: true, info: () => ({ modules: 0, when: null }), onHover: hover, onPick: pick }));
    move($("catalog-Elden Ring")!, 5);
    lines.value = [...lines.value, { key: "Eldoran", row: row("Eldoran") }, { key: "Eldevin", row: row("Eldevin") }];
    await nextTick();
    click($("catalog-Elden Ring")!);
    expect(pick).toHaveBeenLastCalledWith("Elden Ring");
  });

  it("holds back a cover that slid in under a still pointer, but not the highlighted one", async () => {
    const covers = ref<PickerRow[]>([row("Hades")]);
    const hover = vi.fn();
    const pick = vi.fn();
    mount(GamePickerList, () => ({ id: "list", label: "Games", covers: covers.value, lines: [], active: "Hades", custom: null, typed: false, info: () => ({ modules: 0, when: null }), onHover: hover, onPick: pick }));
    // Off the covers, then Rust slides in where the pointer rests.
    root.querySelector('[role="listbox"]')!.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, screenX: 5, screenY: 10 }));
    covers.value = [row("Hades"), row("Rust")];
    await nextTick();
    click($("cover-Rust")!);
    expect(pick).not.toHaveBeenCalled();
    expect(hover).toHaveBeenLastCalledWith("Rust");
    // The items change again: a click on the highlight (where a screen reader routes its click) picks.
    covers.value = [row("Hades"), row("Rust"), row("Celeste")];
    await nextTick();
    click($("cover-Hades")!);
    expect(pick).toHaveBeenLastCalledWith("Hades");
  });
});

describe("AddGameDialog", () => {
  async function open(installed: InstalledGameView[] = []) {
    host.api.installedGames.mockResolvedValue(installed);
    mount(AddGameDialog);
    await settle();
    const search = $("game-search") as HTMLInputElement;
    search.focus();
    return search;
  }
  const press = (element: Element, key: string) => element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

  it("keeps the focus in the search on a press anywhere but a button, and sends keys back to it", async () => {
    const search = await open([game("Hades"), game("Rust")]);
    const padding = $("add-game-dialog")!.querySelector(".overflow-y-auto")!;
    const onPadding = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    padding.dispatchEvent(onPadding);
    expect(onPadding.defaultPrevented).toBe(true);
    const onButton = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    $("open-steam-import")!.dispatchEvent(onButton);
    expect(onButton.defaultPrevented).toBe(false);

    // The focus went elsewhere in the dialog anyway (a scrollbar press): the arrows still move the highlight (both games are covers).
    (padding as HTMLElement).tabIndex = -1;
    (padding as HTMLElement).focus();
    expect(search.getAttribute("aria-activedescendant")).toBe("game-results-option-n:hades");
    press(padding, "ArrowRight");
    await nextTick();
    expect(document.activeElement).toBe(search);
    expect(search.getAttribute("aria-activedescendant")).toBe("game-results-option-n:rust");
  });

  it("lets a press through on an error's text so it can be selected, and leaves shortcuts where they are", async () => {
    host.api.searchCatalog.mockResolvedValue([{ id: "elden-ring", name: "Elden Ring" }]);
    const search = await open();
    search.value = "Elden Ring";
    search.dispatchEvent(new Event("input"));
    await settle();
    host.act.mockResolvedValue({ ok: false, error: "Can't add this game" });
    press(search, "Enter");
    await settle();
    const onError = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    $("add-game-error")!.dispatchEvent(onError);
    expect(onError.defaultPrevented).toBe(false);
    // The press left the focus elsewhere in the dialog: Ctrl+C copies there, a plain key goes to the search.
    const box = $("add-game-error")!.closest(".overflow-y-auto") as HTMLElement;
    box.tabIndex = -1;
    box.focus();
    $("add-game-error")!.dispatchEvent(new KeyboardEvent("keydown", { key: "c", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(box);
    $("add-game-error")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(search);
  });

  it("lists the typed name as the user's own game after the built-in matches, and Enter right after typing adds the top match", async () => {
    const answer = deferred<{ id: string; name: string }[]>();
    host.api.searchCatalog.mockImplementation((text: string) => (text ? answer.promise : Promise.resolve([])));
    const search = await open();
    search.value = "eld";
    search.dispatchEvent(new Event("input"));
    await settle();
    // The built-in list hasn't answered: no own-game line yet, and Enter waits for it.
    expect($("add-custom")).toBeNull();
    host.act.mockImplementation(async (action: { type: string }) => (action.type === "add-workspace" ? { ok: true, id: "elden-ring" } : { ok: true }));
    press(search, "Enter");
    await settle();
    expect(host.act).not.toHaveBeenCalled();
    answer.resolve([{ id: "elden-ring", name: "Elden Ring" }]);
    await settle();
    const options = [...root.querySelectorAll('[role="option"]')].map((option) => option.getAttribute("data-testid"));
    expect(options).toEqual(["catalog-elden-ring", "add-custom"]);
    expect(host.act).toHaveBeenCalledWith({ type: "add-workspace", catalogId: "elden-ring" }, { quiet: true });
  });

  it("under the covers lists only games to add; one already added shows once typed for", async () => {
    state().value = { ...state().value, library: { ...state().value.library, workspaces: { "local-rust": { id: "local-rust", kind: "game", name: "Rust", steamAppId: null } as WorkspaceView } } };
    const search = await open([game("Rust"), game("Hades")]);
    expect(root.querySelector('[data-testid$="n:rust"]')).toBeNull();
    expect(root.querySelector('[data-testid$="n:hades"]')).not.toBeNull();
    search.value = "rust";
    search.dispatchEvent(new Event("input"));
    await settle();
    expect($("catalog-n:rust")!.textContent).toContain("Already added");
  });

  it("says every game here is added when nothing is left to add", async () => {
    state().value = { ...state().value, library: { ...state().value.library, workspaces: { "local-rust": { id: "local-rust", kind: "game", name: "Rust", steamAppId: null } as WorkspaceView } } };
    await open([game("Rust")]);
    expect($("add-game-empty")!.textContent).toContain("every game on this PC");
  });

  it("opens a game added since the list was found instead of adding it again", async () => {
    // The list was found before Hades was added: it still says not added.
    const search = await open([game("Hades", { steamAppId: 1145360, activity: { kind: "played", at: Date.now() } })]);
    expect($("cover-n:hades")!.textContent).not.toContain("Already added");
    state().value = { ...state().value, library: { ...state().value.library, workspaces: { "local-hades": { id: "local-hades", kind: "game", name: "Hades", steamAppId: 1145360 } as WorkspaceView } } };
    await nextTick();
    // The cover stays where it was and says so.
    expect($("cover-n:hades")!.textContent).toContain("Already added");
    host.act.mockResolvedValue({ ok: true });
    press(search, "Enter");
    await settle();
    expect(host.act).toHaveBeenCalledWith({ type: "open-workspace", workspaceId: "local-hades" });
    expect(host.act).not.toHaveBeenCalledWith(expect.objectContaining({ type: "add-workspace" }), expect.anything());
  });

  it("adds a cover's game with the online id and its own modules, then opens it", async () => {
    host.api.catalogForGames.mockResolvedValue({ status: "ok", modules: [{ id: "tavora.nine", name: "Nine", gameIds: ["9-kings"], official: true } as CatalogModuleView] });
    host.api.searchOnline.mockResolvedValue({ status: "ok", games: [{ id: "9-kings", name: "9 Kings", steamAppId: 2784470 }] });
    const search = await open([game("Nine Kings", { steamAppId: 2784470, activity: { kind: "played", at: Date.now() } })]);
    host.act.mockImplementation(async (action: { type: string }) => (action.type === "add-workspace" ? { ok: true, id: "9-kings" } : { ok: true }));
    press(search, "Enter");
    await settle();
    expect(host.act).toHaveBeenCalledWith({ type: "add-workspace", online: { id: "9-kings", name: "9 Kings", steamAppId: 2784470 } }, { quiet: true });
    expect(host.act).toHaveBeenCalledWith({ type: "install-catalog-module", moduleId: "tavora.nine" }, { quiet: true });
    expect(host.act).toHaveBeenCalledWith({ type: "open-workspace", workspaceId: "9-kings" });
  });

  it("opens the copy the user has when add-workspace answers with it, and adds no modules to it", async () => {
    host.api.catalogForGames.mockResolvedValue({ status: "ok", modules: [{ id: "tavora.elden", name: "Map", gameIds: ["elden-ring"], official: true } as CatalogModuleView] });
    host.api.searchCatalog.mockResolvedValue([{ id: "elden-ring", name: "Elden Ring" }]);
    const search = await open();
    search.value = "Elden Ring";
    search.dispatchEvent(new Event("input"));
    await settle();
    host.act.mockImplementation(async (action: { type: string }) => (action.type === "add-workspace" ? { ok: true, id: "elden-ring", existing: true } : { ok: true }));
    press(search, "Enter");
    await settle();
    expect(host.act).not.toHaveBeenCalledWith(expect.objectContaining({ type: "install-catalog-module" }), expect.anything());
    expect(host.act).toHaveBeenCalledWith({ type: "open-workspace", workspaceId: "elden-ring" });
  });
});

describe("OnboardingGame", () => {
  it("keeps the focus in the search on a press anywhere in the step but a button, and sends keys back to it", async () => {
    host.api.installedGames.mockResolvedValue([game("Hades"), game("Rust")]);
    mount(OnboardingGame, () => ({ started: null }));
    await settle();
    const search = $("onboarding-search") as HTMLInputElement;
    search.focus();
    const step = $("onboarding-game")!;
    const onTitle = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    step.querySelector("h1")!.dispatchEvent(onTitle);
    expect(onTitle.defaultPrevented).toBe(true);
    const onButton = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    $("onboarding-back")!.dispatchEvent(onButton);
    expect(onButton.defaultPrevented).toBe(false);

    // The focus went elsewhere in the step anyway (a scrollbar press): the arrows still move the highlight, Enter adds.
    const padding = step.querySelector(".overflow-y-auto") as HTMLElement;
    padding.tabIndex = -1;
    padding.focus();
    expect(search.getAttribute("aria-activedescendant")).toBe("onboarding-results-option-n:hades");
    padding.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    await nextTick();
    expect(document.activeElement).toBe(search);
    expect(search.getAttribute("aria-activedescendant")).toBe("onboarding-results-option-n:rust");
    host.act.mockResolvedValue({ ok: false, error: "Nope" });
    padding.focus();
    padding.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await settle();
    expect(host.act).toHaveBeenCalledWith({ type: "add-workspace", name: "Rust" }, { quiet: true });
  });
});

describe("useCoverArt", () => {
  it("asks for each game's art once, and has none for one it couldn't get", async () => {
    const appids = ref<number[]>([570]);
    const answer = deferred<Record<number, string | null>>();
    host.api.gameCovers.mockReturnValueOnce(answer.promise).mockResolvedValue({ 440: "data:440" });
    let art: ReturnType<typeof useCoverArt> | undefined;
    mount(defineComponent({ setup: () => ((art = useCoverArt(() => appids.value)), () => h("span")) }));
    expect(art!.value[570]).toBeUndefined();
    // Asked again while the first answer is out: not asked twice.
    appids.value = [570, 440];
    await settle();
    answer.resolve({});
    await settle();
    appids.value = [440, 570];
    await settle();
    expect(host.api.gameCovers.mock.calls).toEqual([[[570]], [[440]]]);
    expect(art!.value).toEqual({ 570: null, 440: "data:440" });
  });
});

describe("MadeForGame", () => {
  const workspace = { id: "elden-ring", kind: "game", name: "Elden Ring", steamAppId: 1245620 } as WorkspaceView;
  const listed = (ids: string[]) => ({ status: "ok", modules: ids.map((id) => ({ id, name: id, gameIds: ["elden-ring"], fits: true, official: true, icon: false })) });

  it("holds its place while the catalog is asked, then lists the modules not added yet", async () => {
    const answer = deferred<unknown>();
    host.api.browseCatalog.mockReturnValue(answer.promise);
    mount(MadeForGame, () => ({ workspace }));
    await nextTick();
    expect($("made-for-loading")).not.toBeNull();
    answer.resolve(listed(["tavora.map", "tavora.boss"]));
    await settle();
    expect($("made-for-loading")).toBeNull();
    expect($("made-for-tavora.map")).not.toBeNull();
    expect($("made-for-tavora.boss")).not.toBeNull();
  });

  it("says why the other Add waits, and shows a failed one's error", async () => {
    host.api.browseCatalog.mockResolvedValue(listed(["tavora.map", "tavora.boss"]));
    const install = deferred<unknown>();
    host.act.mockReturnValue(install.promise);
    mount(MadeForGame, () => ({ workspace }));
    await settle();
    $("made-for-add-tavora.map")!.click();
    await nextTick();
    const other = $("made-for-add-tavora.boss")!;
    expect(other.getAttribute("aria-disabled")).toBe("true");
    expect(other.getAttribute("aria-description")).toBe("Another module is being added.");
    install.resolve({ ok: false, error: "Couldn't reach the catalog." });
    await settle();
    expect($("made-for-error-tavora.map")!.textContent).toContain("Couldn't reach the catalog.");
  });

  it("offers Ask for a module when the catalog has none for the game", async () => {
    host.api.browseCatalog.mockResolvedValue(listed([]));
    mount(MadeForGame, () => ({ workspace }));
    await settle();
    expect($("ask-module")!.textContent).toContain("Elden Ring");
  });
});
