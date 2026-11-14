// @vitest-environment jsdom
// Discord voice is paused (shared/discord-voice.ts, the owner's decision of 2026-11-14): Settings > Connections and its
// search leave Discord out even when an installed module asks for it, and a Discord panel only says it's paused:
// no install button, no access review, no other panel types and no Remove (closing its tab closes it as usual).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, h, nextTick, type App } from "vue";
import type { HostViewState } from "../shared/host-api";

vi.hoisted(() => {
  // Every listener is taken and never called, every other call answers nothing: the test sets the state itself.
  (window as unknown as { tavoraHost: unknown }).tavoraHost = new Proxy({} as Record<string, unknown>, {
    get: (_, key) => (typeof key === "string" && key.startsWith("on") ? () => () => undefined : () => Promise.resolve(null)),
  });
  document.elementsFromPoint ??= () => [];
  if (!("PerformanceObserver" in globalThis)) (globalThis as Record<string, unknown>).PerformanceObserver = class { observe() {} disconnect() {} };
});
const empty = vi.hoisted(() => async () => {
  const { defineComponent, h } = await import("vue");
  return { default: defineComponent({ setup: () => () => h("div") }) };
});
vi.mock("./components/GrantDialog.vue", empty);
vi.mock("./components/LeaderboardQuestion.vue", empty);
vi.mock("./components/workspace/BrowserToolbar.vue", empty);
vi.mock("./components/workspace/CampfireLoader.vue", empty);

import { hiddenSettingIds, state } from "./host";
import { settingEntries } from "./components/settings/settings-index";
import PanelContent from "./components/workspace/PanelContent.vue";
import { DOCK } from "./components/workspace/dock-context";

/** The Discord module installed, asking for the connector and for access not granted yet, with an update waiting. */
const DISCORD = {
  id: "wellbrained.discord",
  name: "Discord",
  origin: { kind: "catalog" },
  panels: [{ id: "voice", name: "Voice" }],
  permissions: { asks: { network: [], connectors: ["discord"], folders: [] }, missing: { network: [], connectors: ["discord"], folders: [] } },
  update: { version: "9.9.9" },
};

let app: App | undefined;
let root: HTMLElement;
beforeEach(() => {
  state.value = {
    language: { resolved: "en" },
    appearance: { themes: [], themeId: "", variationId: "" },
    library: { onboarded: true, workspaces: {}, onlineSearch: true },
    modules: [DISCORD],
    panels: [],
    developmentFolders: [],
    gameOverlays: { supported: false },
  } as unknown as HostViewState;
  root = document.createElement("div");
  document.body.append(root);
});
afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = "";
});

function mountPanel(panel: Record<string, unknown>) {
  state.value = { ...state.value!, panels: [panel] } as unknown as HostViewState;
  app = createApp({ render: () => h(PanelContent, { params: { api: { id: panel.instanceId } } as never }) });
  app.provide(DOCK, { register: () => undefined, unregister: () => undefined } as never);
  app.mount(root);
}
const shown = (selector: string) => root.querySelector(selector);

describe("Discord voice, paused", () => {
  it("leaves Discord out of Settings > Connections and its search, though an installed module asks for it", () => {
    expect(hiddenSettingIds.value.has("discord-connection")).toBe(true);
    expect(settingEntries(new Set(), hiddenSettingIds.value).some((entry) => entry.id === "discord-connection")).toBe(false);
  });

  it("shows a Discord panel as paused, with nothing to install, review or remove", async () => {
    mountPanel({ instanceId: "p1", moduleId: "wellbrained.discord", panelType: "voice", name: "Discord", status: "unavailable", waiting: false, content: null, paused: true });
    await nextTick();
    expect(shown('[data-testid="panel-paused-p1"]')?.textContent).toBe("Discord is taking a break");
    expect(root.textContent).toContain("We've paused Discord in Tavora for now.");
    expect(shown('[data-testid="install-moved-module"]')).toBeNull();
    expect(shown('[data-testid="remove-unavailable-panel"]')).toBeNull();
    expect(shown('[data-testid="choose-panel-type-voice"]')).toBeNull();
    expect(shown('[data-testid="grant-review-p1"]')).toBeNull();
    expect(shown('[data-testid="update-review-p1"]')).toBeNull();
  });

  it("still offers the install for AI Usage, which isn't paused", async () => {
    mountPanel({ instanceId: "p2", moduleId: "wellbrained.ai-usage", panelType: null, name: "AI Usage", status: "unavailable", waiting: false, content: null, moved: true });
    await nextTick();
    expect(shown('[data-testid="panel-module-moved-p2"]')).not.toBeNull();
    expect(shown('[data-testid="install-moved-module"]')).not.toBeNull();
    expect(shown('[data-testid="panel-paused-p2"]')).toBeNull();
  });
});
