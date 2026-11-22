// @vitest-environment jsdom
// Running a panel while its game runs (main/with-game.ts), as the host UI shows it: the row in the consent dialog, whose
// Allow grants it with the rest, and the switch per module in Settings > Connections. The real host.ts runs on a
// stand-in for the main process: `act` answers ok.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, h, nextTick, type App } from "vue";
import type { ActionResult, HostAction, HostViewState } from "../../shared/host-api";

const bridge = vi.hoisted(() => {
  const act = vi.fn<(action: HostAction) => Promise<ActionResult>>(async () => ({ ok: true }));
  // Every listener is taken and never called, every other call answers nothing: the test sets the state itself.
  const api = new Proxy({} as Record<string, unknown>, {
    get: (_, key) => (key === "act" ? act : typeof key === "string" && key.startsWith("on") ? () => () => undefined : () => Promise.resolve(null)),
  });
  (window as unknown as { tavoraHost: unknown }).tavoraHost = api;
  document.elementsFromPoint ??= () => [];
  if (!("PerformanceObserver" in globalThis)) (globalThis as Record<string, unknown>).PerformanceObserver = class { observe() {} disconnect() {} };
  return { act };
});
// The dialog frame and its buttons as plain elements, so the test needs no popups.
vi.mock("./ModalDialog.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return { default: defineComponent({ emits: ["close"], setup: (_, { slots }) => () => h("div", slots.default?.()) }) };
});
vi.mock("@tavora/official-ui/components/ui/dialog", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    DialogFooter: defineComponent({ setup: (_, { slots }) => () => h("div", slots.default?.()) }),
    DialogButton: defineComponent({
      inheritAttrs: false,
      props: { type: String },
      setup: (props, { slots, attrs }) => () => h("button", { type: props.type ?? "button", "data-testid": attrs["data-testid"], onClick: attrs.onClick }, slots.default?.()),
    }),
  };
});

import { dialog, hiddenSettingIds, state, type GrantRequest } from "../host";
import GrantDialog from "./GrantDialog.vue";
import ConnectionsSection from "./settings/ConnectionsSection.vue";

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const KINGS = "wellbrained.nine-kings";
const none = { network: [], connectors: [], folders: [] };

/** One module that runs with its game: asked, granted and still missing as given. */
function hostState(module: { granted?: boolean; missing?: boolean; gameName?: string } = {}): HostViewState {
  return {
    language: { resolved: "en" },
    appearance: { themes: [], themeId: "", variationId: "" },
    library: { onboarded: true, workspaces: {} },
    modules: [
      {
        id: KINGS,
        name: "9 Kings Companion",
        version: "1.0.0",
        provenance: "local",
        origin: { kind: "own" },
        publisher: null,
        usedIn: [],
        ...(module.gameName ? { gameName: module.gameName } : {}),
        permissions: { asks: { ...none, withGame: true }, granted: { ...none, ...(module.granted ? { withGame: true } : {}) }, missing: { ...none, ...(module.missing ? { withGame: true } : {}) } },
      },
    ],
    panels: [],
    developmentFolders: [],
    gameOverlays: { supported: false },
  } as unknown as HostViewState;
}

let app: App | undefined;
let root: HTMLElement;
beforeEach(() => {
  bridge.act.mockReset();
  bridge.act.mockResolvedValue({ ok: true });
  root = document.createElement("div");
  document.body.append(root);
});
afterEach(() => {
  app?.unmount();
  app = undefined;
  dialog.value = null;
  document.body.innerHTML = "";
});
const find = (id: string) => root.querySelector<HTMLElement>(`[data-testid="${id}"]`);

describe("the consent dialog", () => {
  const request: GrantRequest = { kind: "grant", moduleId: KINGS, slot: null, review: false };

  it("asks to run while the game runs, naming the game, and Allow grants it with the rest", async () => {
    state.value = hostState({ missing: true, gameName: "9 Kings" });
    dialog.value = request;
    app = createApp({ render: () => h(GrantDialog, { request }) });
    app.mount(root);
    await settle();
    expect(find("grant-with-game")?.textContent).toContain("Run while 9 Kings runs");
    expect(find("grant-with-game")?.textContent).toContain("It keeps working out of sight while you play.");
    find("grant-allow")!.click();
    await settle();
    expect(bridge.act.mock.calls[0]![0]).toEqual({ type: "grant-module", moduleId: KINGS, network: [], connectors: [], folders: [], withGame: true });
  });

  it("says its game without a name when the module isn't for one game in the library", async () => {
    state.value = hostState({ missing: true });
    dialog.value = request;
    app = createApp({ render: () => h(GrantDialog, { request }) });
    app.mount(root);
    await settle();
    expect(find("grant-with-game")?.textContent).toContain("Run while its game runs");
  });

  it("closes itself when nothing is left to ask", async () => {
    state.value = hostState({ granted: true });
    dialog.value = request;
    app = createApp({ render: () => h(GrantDialog, { request }) });
    app.mount(root);
    await settle();
    expect(dialog.value).toBeNull();
  });
});

describe("Settings > Connections", () => {
  async function mountSection() {
    app = createApp({ render: () => h(ConnectionsSection, { highlight: "with-game" }) });
    app.mount(root);
    await settle();
    await nextTick();
  }

  it("lists a module that asks with a switch, which turns running with its game on and off", async () => {
    state.value = hostState({ granted: true });
    await mountSection();
    const sw = find(`with-game-switch-${KINGS}`)!;
    expect(sw.getAttribute("aria-label")).toBe("Let 9 Kings Companion run while its game runs");
    expect(sw.getAttribute("data-state")).toBe("checked");
    sw.click();
    await settle();
    expect(bridge.act.mock.calls.map(([action]) => action)).toEqual([{ type: "set-module-with-game", moduleId: KINGS, on: false }]);
  });

  it("shows the switch off for a module switched off, and on asks to turn it on", async () => {
    state.value = hostState({ granted: false });
    await mountSection();
    const sw = find(`with-game-switch-${KINGS}`)!;
    expect(sw.getAttribute("data-state")).toBe("unchecked");
    sw.click();
    await settle();
    expect(bridge.act.mock.calls.map(([action]) => action)).toEqual([{ type: "set-module-with-game", moduleId: KINGS, on: true }]);
  });

  it("is hidden until an installed module asks for it", () => {
    state.value = { ...hostState(), modules: [] } as unknown as HostViewState;
    expect(hiddenSettingIds.value.has("with-game")).toBe(true);
    state.value = hostState();
    expect(hiddenSettingIds.value.has("with-game")).toBe(false);
  });
});
