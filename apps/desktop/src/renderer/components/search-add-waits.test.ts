// @vitest-environment jsdom
// Ctrl+K (SearchDialog.vue): an "Add <game>" row keeps the box open with the row busy while the game is added, takes
// no other row meanwhile, and closes the box once the game is open. The host is a fake whose answers the test gives.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, type App } from "vue";
import type { HostViewState } from "../../shared/host-api";

const host = vi.hoisted(() => ({
  act: vi.fn(),
  addModule: vi.fn(),
  openSettings: vi.fn(),
  showOrAddPanel: vi.fn(),
  showToast: vi.fn(),
  api: { searchCatalog: vi.fn(), searchOnline: vi.fn() },
}));
vi.mock("../host", async () => {
  const { computed, ref, shallowRef } = await import("vue");
  return {
    ...host,
    state: shallowRef(null),
    dialog: ref(null),
    searchOpen: ref(false),
    searchStart: ref(""),
    hiddenSettings: computed(() => new Set()),
    hiddenSettingIds: computed(() => new Set()),
  };
});

import { searchOpen, state } from "../host";
import SearchDialog from "./SearchDialog.vue";

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((ok) => (resolve = ok));
  return { promise, resolve };
}
const settle = async () => {
  for (let i = 0; i < 3; i++) await new Promise((resolve) => setTimeout(resolve, 10));
};

let app: App | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  state.value = {
    screen: "home",
    currentWorkspaceId: null,
    modules: [],
    snapshots: [],
    library: { workspaces: {}, recent: [], rail: { expanded: true } },
  } as unknown as HostViewState;
  host.api.searchCatalog.mockResolvedValue([{ id: "hollow-knight", name: "Hollow Knight" }]);
  host.api.searchOnline.mockResolvedValue({ games: [] });
});
afterEach(() => {
  app?.unmount();
  app = undefined;
  searchOpen.value = false;
  document.body.innerHTML = "";
});

async function openWith(text: string) {
  const root = document.createElement("div");
  document.body.append(root);
  app = createApp(defineComponent({ render: () => h(SearchDialog) }));
  app.mount(root);
  searchOpen.value = true;
  await nextTick();
  const input = document.querySelector<HTMLInputElement>('[data-testid="search-input"]')!;
  input.value = text;
  input.dispatchEvent(new Event("input"));
  await settle();
  return input;
}
const row = () => document.querySelector<HTMLElement>('[data-testid="search-add-game-hollow-knight"]');

describe("Ctrl+K add a game", () => {
  it("keeps the box open with the row busy until the game is open, and adds it once", async () => {
    const adding = deferred<{ ok: boolean; id?: string }>();
    host.act.mockImplementation((action: { type: string }) => (action.type === "add-workspace" ? adding.promise : Promise.resolve({ ok: true })));
    const input = await openWith("hollow");
    expect(row()).not.toBeNull();

    row()!.click();
    await settle();
    expect(searchOpen.value).toBe(true);
    expect(row()!.getAttribute("aria-busy")).toBe("true");

    // Chosen again, or Enter on any row, while it adds: nothing more runs.
    row()!.click();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await settle();
    expect(host.act).toHaveBeenCalledExactlyOnceWith({ type: "add-workspace", catalogId: "hollow-knight" });

    adding.resolve({ ok: true, id: "hollow-knight" });
    await settle();
    expect(host.act).toHaveBeenLastCalledWith({ type: "open-workspace", workspaceId: "hollow-knight" });
    expect(searchOpen.value).toBe(false);
  });

  it("doesn't close a box opened again after it was closed while adding", async () => {
    const adding = deferred<{ ok: boolean; id?: string }>();
    host.act.mockImplementation(() => adding.promise);
    await openWith("hollow");
    row()!.click();
    await settle();

    searchOpen.value = false;
    await settle();
    searchOpen.value = true;
    await settle();
    adding.resolve({ ok: false });
    await settle();
    expect(searchOpen.value).toBe(true);
  });
});
