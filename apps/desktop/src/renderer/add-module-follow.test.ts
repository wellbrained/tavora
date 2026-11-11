// @vitest-environment jsdom
// The module library follows a new request while it is open: Browse after a Publish opens that module's page in the
// catalog (the same one again too), Updates from the sidebar shows the updates.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import type { HostViewState } from "../shared/host-api";

vi.hoisted(() => {
  // Every listener is taken and never called, every other call answers nothing: the test sets the state itself.
  (window as unknown as { tavoraHost: unknown }).tavoraHost = new Proxy({} as Record<string, unknown>, {
    get: (_, key) => (typeof key === "string" && key.startsWith("on") ? () => () => undefined : () => Promise.resolve(null)),
  });
  document.elementsFromPoint ??= () => [];
  if (!("PerformanceObserver" in globalThis)) (globalThis as Record<string, unknown>).PerformanceObserver = class { observe() {} disconnect() {} };
});
const seen = vi.hoisted(() => ({ browse: [] as Array<string | undefined> }));
// The dialog frame as plain elements, so the test needs no popups.
vi.mock("@tavora/official-ui/components/ui/dialog", async () => {
  const { defineComponent, h } = await import("vue");
  const plain = defineComponent({ inheritAttrs: true, setup: (_, { slots }) => () => h("div", slots.default?.()) });
  return { Dialog: plain, DialogClose: plain, DialogContent: plain, DialogTitle: plain };
});
// The catalog as an element that says which module page it opened, counting each start.
vi.mock("./components/CatalogBrowse.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    default: defineComponent({
      props: { open: String, query: String },
      setup: (props) => {
        seen.browse.push(props.open);
        return () => h("div", { "data-testid": "catalog", "data-open": props.open });
      },
    }),
  };
});
vi.mock("./components/ModuleUpdates.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return { default: defineComponent({ setup: () => () => h("div", { "data-testid": "module-updates" }) }) };
});

const empty = vi.hoisted(() => async () => {
  const { defineComponent, h } = await import("vue");
  return { default: defineComponent({ setup: () => () => h("div") }) };
});
vi.mock("./components/menus/MenuButton.vue", empty);
vi.mock("./components/CatalogModuleDialog.vue", empty);
vi.mock("./components/ModuleIcon.vue", empty);

import { dialog, state } from "./host";
import AddModuleDialog from "./components/AddModuleDialog.vue";

let app: App | undefined;
let root: HTMLElement;
beforeEach(() => {
  seen.browse.length = 0;
  state.value = {
    language: { resolved: "en" },
    appearance: { themes: [], themeId: "", variationId: "" },
    library: { onboarded: true, workspaces: {} },
    modules: [],
    panels: [],
    developmentFolders: [],
    gameOverlays: { supported: false },
  } as unknown as HostViewState;
  root = document.createElement("div");
  document.body.append(root);
});
afterEach(async () => {
  app?.unmount();
  app = undefined;
  dialog.value = null;
  await nextTick();
  document.body.innerHTML = "";
});

function open() {
  app = createApp(AddModuleDialog);
  app.mount(root);
}
const shown = (id: string) => root.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

describe("the module library, open", () => {
  it("opens a module page asked for after it opened, and the same one again", async () => {
    dialog.value = { kind: "add-module" };
    open();
    expect(shown("catalog")).toBeNull();
    dialog.value = { kind: "add-module", browse: "dev.notes" };
    await nextTick();
    expect(shown("catalog")?.dataset.open).toBe("dev.notes");
    dialog.value = { kind: "add-module", browse: "dev.notes" };
    await nextTick();
    expect(seen.browse).toEqual(["dev.notes", "dev.notes"]);
  });

  it("shows the updates asked for from the sidebar", async () => {
    dialog.value = { kind: "add-module" };
    open();
    dialog.value = { kind: "add-module", view: "updates" };
    await nextTick();
    expect(shown("module-updates")).not.toBeNull();
  });
});
