// @vitest-environment jsdom
import type { JsonValue, TavoraSDK } from "@tavora/sdk";
import { createMemoryHost, type MemoryHost } from "@tavora/sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick, type App as VueApp } from "vue";
import { LIST_ID, LIST_TITLE, parseList, type TodoList } from "./todos";

// The panel over the game: while Tavora lends it to the in-game layer it draws the live view's plate to edit in place
// (EditPlate.vue) instead of the full panel, and an older Tavora, which never says so, keeps the full panel.

/** The SDK the page connects with; connectModule normally finds Tavora's bridge. */
const current = vi.hoisted(() => ({ sdk: null as unknown }));
vi.mock("@tavora/official-ui", async (original) => {
  const kit = await original<typeof import("@tavora/official-ui")>();
  return { ...kit, connectModule: (options: Parameters<typeof kit.connectModule>[0]) => kit.connectModule({ ...options, sdk: current.sdk as TavoraSDK }) };
});

// The Undo toast measures itself; jsdom has nothing to measure with.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const { default: App } = await import("./App.vue");

let app: VueApp | undefined;
afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = "";
  document.documentElement.className = "";
});

const AT = "2026-11-18T10:00:00.000Z";
const task = (id: string, title: string, extra: object = {}) => ({ id, title, done: false, details: "", pinned: false, parentId: null, createdAt: AT, doneAt: null, ...extra });
const LIST = { version: 2, groups: [{ id: "g", name: "Main", color: "", tasks: [task("t1", "Find the crypt"), task("t2", "Light the torch")] }] };

const settle = async () => {
  for (let turn = 0; turn < 10; turn++) {
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

async function mount(options: { version?: string; overGame?: boolean; state?: JsonValue } = {}) {
  const { sdk, host } = createMemoryHost({ ...(options.version ? { version: options.version } : {}), ...(options.state !== undefined ? { state: options.state } : {}) });
  host.documents.put({ id: LIST_ID, title: LIST_TITLE, data: LIST });
  if (options.overGame) host.setPanelOverGame(true);
  current.sdk = sdk;
  const root = document.createElement("div");
  root.id = "app";
  document.body.append(root);
  app = createApp(App);
  app.mount(root);
  await settle();
  return host;
}

const $ = (selector: string) => document.querySelector<HTMLElement>(selector);
const stored = (host: MemoryHost): TodoList => parseList(host.documents.get(LIST_ID)!.data);
const plateTexts = () => [...document.querySelectorAll("[data-testid=plate-title]")].map((el) => el.textContent);

describe("over the game", () => {
  it("swaps the full panel for the plate while the panel is lent, and back", async () => {
    const host = await mount();
    expect($("[data-testid=todos-app]")).not.toBeNull();
    expect($("[data-testid=edit-plate]")).toBeNull();

    host.setPanelOverGame(true);
    await settle();
    expect($("[data-testid=todos-app]")).toBeNull();
    expect($("[data-testid=edit-plate]")?.classList.contains("live-plate")).toBe(true);
    expect(document.documentElement.classList.contains("over-game")).toBe(true);
    expect(plateTexts()).toEqual(["Find the crypt", "Light the torch"]);
    // The toolbar and group settings stay in the full panel.
    expect($("[data-testid=todos-toolbar]")).toBeNull();
    expect($("[data-testid=group-menu]")).toBeNull();

    host.setPanelOverGame(false);
    await settle();
    expect($("[data-testid=todos-app]")).not.toBeNull();
    expect(document.documentElement.classList.contains("over-game")).toBe(false);
  });

  it("shows the plate when the page loads while the panel is already over the game", async () => {
    await mount({ overGame: true });
    expect($("[data-testid=edit-plate]")).not.toBeNull();
  });

  it("keeps the full panel on a Tavora without the signal", async () => {
    const host = await mount({ version: "0.24.89" });
    host.setPanelOverGame(true);
    await settle();
    expect($("[data-testid=edit-plate]")).toBeNull();
    expect($("[data-testid=todos-app]")).not.toBeNull();
  });

  it("ticks with the box, renames on a double-click and adds from the last line", async () => {
    const host = await mount({ overGame: true });
    const row = (id: string) => $(`[data-testid=plate-task-${id}]`)!;

    const box = row("t1").querySelector<HTMLElement>("[data-testid=plate-done]")!;
    expect(box.getAttribute("aria-label")).toBe("Mark “Find the crypt” as done");
    box.click();
    await settle();
    expect(stored(host).groups[0]!.tasks[0]!.done).toBe(true);
    // It stays, ticked (Keep finished to-dos is on in a new panel).
    expect(row("t1").classList.contains("done")).toBe(true);

    row("t2").querySelector<HTMLElement>("[data-testid=plate-title]")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await settle();
    const input = row("t2").querySelector<HTMLTextAreaElement>("[data-testid=plate-title-input]")!;
    expect(input.value).toBe("Light the torch");
    input.value = "Light both torches";
    input.dispatchEvent(new Event("input"));
    await nextTick();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    expect(stored(host).groups[0]!.tasks[1]!.title).toBe("Light both torches");
    expect(row("t2").querySelector("[data-testid=plate-title-input]")).toBeNull();

    const add = $("[data-testid=plate-add] input") as HTMLInputElement;
    add.value = "Tame a wolf";
    add.dispatchEvent(new Event("input"));
    // The kit's Input passes the text on a tick later.
    await nextTick();
    $("[data-testid=plate-add]")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await settle();
    expect(stored(host).groups[0]!.tasks.map((item) => item.title)).toEqual(["Find the crypt", "Light both torches", "Tame a wolf"]);
  });

  it("keeps a title being typed when the layer closes, and waits for the end of IME input", async () => {
    const host = await mount({ overGame: true });
    const row = $("[data-testid=plate-task-t2]")!;
    row.querySelector<HTMLElement>("[data-testid=plate-title]")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await settle();
    const input = row.querySelector<HTMLTextAreaElement>("[data-testid=plate-title-input]")!;
    input.value = "Light the 松明";
    input.dispatchEvent(new Event("input"));
    await nextTick();
    // Enter that picks a word while composing doesn't save.
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true }));
    await settle();
    expect(row.querySelector("[data-testid=plate-title-input]")).not.toBeNull();
    expect(stored(host).groups[0]!.tasks[1]!.title).toBe("Light the torch");

    host.setPanelOverGame(false);
    await settle();
    expect(stored(host).groups[0]!.tasks[1]!.title).toBe("Light the 松明");
  });

  it("gives every control a name, and has no row menu (that stays in the panel in Tavora)", async () => {
    await mount({ overGame: true });
    expect($("[data-testid=plate-task-menu]")).toBeNull();
    const boxes = [...document.querySelectorAll<HTMLElement>("[data-testid=plate-done]")];
    expect(boxes.map((box) => box.getAttribute("aria-label"))).toEqual(["Mark “Find the crypt” as done", "Mark “Light the torch” as done"]);
    expect(($("[data-testid=plate-add] input") as HTMLInputElement).getAttribute("aria-label")).toBe("Add a to-do");
  });

  it("offers no Undo over the game: no toast pops up there, and Ctrl+Z does nothing", async () => {
    const host = await mount({ overGame: true });
    const toasts = () => document.querySelectorAll("[data-testid=undo-toast]").length;
    expect($("[data-slot=toaster-host]")).toBeNull();

    $("[data-testid=plate-task-t1] [data-testid=plate-done]")!.click();
    await settle();
    expect(stored(host).groups[0]!.tasks[0]!.done).toBe(true);

    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }));
    await settle();
    expect(stored(host).groups[0]!.tasks[0]!.done).toBe(true);
    expect(toasts()).toBe(0);

    // Back in the workspace, nothing from the game is waiting to be undone, and Undo works there as before.
    host.setPanelOverGame(false);
    await settle();
    expect($("[data-slot=toaster-host]")).not.toBeNull();
    expect(toasts()).toBe(0);
    $("[data-testid=task-t1] [data-testid=task-done]")!.click();
    await settle();
    expect(stored(host).groups[0]!.tasks[0]!.done).toBe(false);
    expect(toasts()).toBe(0);
    // Ticking in the workspace offers Undo.
    $("[data-testid=task-t1] [data-testid=task-done]")!.click();
    await settle();
    expect(toasts()).toBe(1);
  });

  it("shows finished to-dos on the plate exactly when the panel keeps them", async () => {
    const done = { version: 2, groups: [{ id: "g", name: "Main", color: "", tasks: [task("t1", "Find the crypt", { done: true, doneAt: AT }), task("t2", "Light the torch")] }] };
    const kept = await mount({ overGame: true });
    kept.documents.put({ id: LIST_ID, title: LIST_TITLE, data: done });
    await settle();
    expect(plateTexts()).toEqual(["Find the crypt", "Light the torch"]);
    app?.unmount();
    document.body.innerHTML = "";

    // A panel saved with the switch off, and an overlay look that showed them (kept on its own before): the switch wins.
    const vanish = await mount({ overGame: true, state: { finished: "vanish", collapsed: [], folded: [], live: { showFinished: true } } });
    vanish.documents.put({ id: LIST_ID, title: LIST_TITLE, data: done });
    await settle();
    expect(plateTexts()).toEqual(["Light the torch"]);
  });
});

describe("Keep finished to-dos", () => {
  const saved = async () => (await (current.sdk as TavoraSDK).panel.getState<{ finished: string; live: { showFinished: boolean } }>())!;

  it("is one switch for the panel and the overlay, and is still written with the look for the version before", async () => {
    await mount();
    const toggle = () => $("[data-testid=finished-mode]")!;
    expect(toggle().dataset.mode).toBe("stay");
    toggle().click();
    await settle();
    expect(toggle().dataset.mode).toBe("vanish");
    expect(await saved()).toMatchObject({ finished: "vanish", live: { showFinished: false } });
    toggle().click();
    await settle();
    expect(await saved()).toMatchObject({ finished: "stay", live: { showFinished: true } });
  });

  it("is the same choice as Finished to-dos on the settings' Content page", async () => {
    // The settings draw their preview once the fonts are in; jsdom has none to wait for.
    if (!("fonts" in document)) Object.defineProperty(document, "fonts", { value: { ready: Promise.resolve() }, configurable: true });
    const host = await mount();
    host.setDialog(true);
    await settle();
    $("[data-testid=settings-page-content]")!.click();
    await settle();
    const show = $("[data-testid=live-finished-show]")!;
    expect(show.getAttribute("data-state")).toBe("checked");
    $("[data-testid=live-finished-hide]")!.click();
    await settle();
    expect(await saved()).toMatchObject({ finished: "vanish", live: { showFinished: false } });
    host.setDialog(false);
    await settle();
    expect($("[data-testid=finished-mode]")!.dataset.mode).toBe("vanish");
  });
});
