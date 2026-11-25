// @vitest-environment jsdom
// Bug hunt B (2026-11-25): main sends a fresh copy of the workspace after every action. The empty page must not ask the
// catalog again (and blank the game's tiles) when only the copy is new. The host is a fake.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, shallowRef, type App } from "vue";
import type { WorkspaceView } from "../../../shared/host-api";

const host = vi.hoisted(() => ({ browseCatalog: vi.fn(), act: vi.fn(), addModule: vi.fn(), openPanels: vi.fn() }));
vi.mock("../../host", async () => {
  const { ref, shallowRef } = await import("vue");
  return {
    act: host.act,
    addModule: host.addModule,
    openPanels: host.openPanels,
    api: { browseCatalog: host.browseCatalog },
    dialog: ref(null),
    installProgress: ref({}),
    state: shallowRef({ modules: [], library: { askedModules: [] } }),
  };
});
vi.mock("../CatalogIcon.vue", async () => ({ default: (await import("vue")).defineComponent({ render: () => null }) }));
vi.mock("../ModuleIcon.vue", async () => ({ default: (await import("vue")).defineComponent({ render: () => null }) }));

import StartModules from "./StartModules.vue";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const settle = async () => {
  await tick();
  await tick();
};

const workspace = (): WorkspaceView => ({ id: "game-1", kind: "game", name: "A game", steamAppId: null }) as unknown as WorkspaceView;
const made = { id: "wellbrained.planner", name: "Planner", description: null, icon: false, fits: true, official: false, gameIds: ["game-1"] };

let app: App | undefined;
let root: HTMLElement;
beforeEach(() => {
  host.browseCatalog.mockReset();
  host.browseCatalog.mockResolvedValue({ status: "ok", modules: [made] });
  root = document.createElement("div");
  document.body.append(root);
});
afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = "";
});
const $ = (id: string) => root.querySelector(`[data-testid="${id}"]`);

describe("StartModules", () => {
  it("keeps the game's tiles when main sends the same workspace again", async () => {
    const shown = shallowRef(workspace());
    app = createApp(defineComponent({ render: () => h(StartModules, { workspace: shown.value }) }));
    app.mount(root);
    await settle();
    expect(host.browseCatalog).toHaveBeenCalledTimes(1);
    expect($("made-for-add-wellbrained.planner")).not.toBeNull();

    shown.value = workspace();
    await nextTick();
    expect($("made-for-loading")).toBeNull();
    expect($("made-for-add-wellbrained.planner")).not.toBeNull();
    await settle();
    expect(host.browseCatalog).toHaveBeenCalledTimes(1);
  });

  it("asks again for another workspace", async () => {
    const shown = shallowRef(workspace());
    app = createApp(defineComponent({ render: () => h(StartModules, { workspace: shown.value }) }));
    app.mount(root);
    await settle();
    shown.value = { ...workspace(), id: "game-2" } as WorkspaceView;
    await settle();
    expect(host.browseCatalog).toHaveBeenCalledTimes(2);
    expect(host.browseCatalog).toHaveBeenLastCalledWith({ workspaceId: "game-2" });
  });
});
