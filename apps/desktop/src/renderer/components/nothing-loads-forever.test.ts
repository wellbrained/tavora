// @vitest-environment jsdom
// Nothing keeps loading: a load or a busy button always ends, also when the request throws (CLAUDE.md "State"). The host is
// replaced by a fake whose answers the test gives by hand.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, h, ref, shallowRef, type App, type Component } from "vue";
import type { CatalogListResult, CatalogModuleView } from "../../shared/host-api";

const host = vi.hoisted(() => ({
  act: vi.fn(),
  api: {
    browseCatalog: vi.fn(),
    catalogPage: vi.fn(),
    catalogReviews: vi.fn(),
    catalogIcon: vi.fn(),
    contactDraft: vi.fn(),
    modulePage: vi.fn(),
    profileRanks: vi.fn(),
  },
  notSaved: vi.fn(),
  openProfile: vi.fn(),
  openInbox: vi.fn(),
  openSettings: vi.fn(),
  showToast: vi.fn(),
  addModule: vi.fn(),
  closeDialog: vi.fn(),
  installProgress: {},
}));
vi.mock("../host", async () => {
  const { ref } = await import("vue");
  return {
    ...host,
    dialog: ref(null),
    account: ref(null),
    state: ref({ modules: [], profile: { name: "Ada", initials: "A", ranks: { hidden: true } } }),
  };
});
// Plain frames and controls in place of the kit's popups, so the test needs no portals.
vi.mock("./ModalDialog.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return { default: defineComponent({ props: { status: String }, emits: ["close"], setup: (props, { slots }) => () => h("div", { "data-testid": "frame", "data-status": props.status }, slots.default?.()) }) };
});
vi.mock("@tavora/official-ui/components/ui/dialog", async () => {
  const { defineComponent, h } = await import("vue");
  const frame = (tag: string) => defineComponent({ inheritAttrs: true, setup: (_, { slots }) => () => h(tag, slots.default?.()) });
  return {
    Dialog: frame("div"),
    DialogContent: frame("section"),
    DialogTitle: frame("h2"),
    DialogDescription: frame("p"),
    DialogFooter: frame("div"),
    DialogButton: defineComponent({
      inheritAttrs: false,
      props: { type: String, disabled: Boolean },
      setup: (props, { slots, attrs }) => () => h("button", { type: props.type ?? "button", disabled: props.disabled, "data-testid": attrs["data-testid"], onClick: attrs.onClick }, slots.default?.()),
    }),
  };
});
vi.mock("@tavora/official-ui/components/ui/select", async () => {
  const { defineComponent, h } = await import("vue");
  const passthrough = (tag: string) => defineComponent({ setup: (_, { slots }) => () => h(tag, slots.default?.()) });
  return { Select: passthrough("div"), SelectContent: passthrough("div"), SelectItem: passthrough("div"), SelectTrigger: passthrough("div"), SelectValue: passthrough("span") };
});
vi.mock("./ModuleDescription.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return { default: defineComponent({ setup: (_, { slots }) => () => h("div", slots.default?.()) }) };
});
vi.mock("./CatalogRating.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return { default: defineComponent({ setup: () => () => h("span") }) };
});
vi.mock("./settings/SettingGroup.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return { default: defineComponent({ setup: (_, { slots }) => () => h("div", slots.default?.()) }) };
});
vi.mock("./settings/SettingRow.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return { default: defineComponent({ setup: (_, { slots }) => () => h("div", slots.default?.()) }) };
});
vi.mock("./ModuleVersions.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return { default: defineComponent({ setup: () => () => h("span") }) };
});
vi.mock("./ModuleIcon.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return { default: defineComponent({ setup: () => () => h("span") }) };
});
vi.mock("./messages/ReportModuleDialog.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return { default: defineComponent({ setup: () => () => h("span") }) };
});

import CatalogBrowse from "./CatalogBrowse.vue";
import CatalogIcon from "./CatalogIcon.vue";
import CatalogModuleDialog from "./CatalogModuleDialog.vue";
import CatalogReviewsView from "./CatalogReviews.vue";
import ContactDeveloperDialog from "./messages/ContactDeveloperDialog.vue";
import ProfileEditor from "./profile/ProfileEditor.vue";
import PromptDialog from "./PromptDialog.vue";
import type { PromptRequest } from "../host";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const settle = async () => {
  await tick();
  await tick();
};

let app: App | undefined;
let root: HTMLElement;
beforeEach(() => {
  for (const fn of [host.act, ...Object.values(host.api)]) fn.mockReset();
  root = document.createElement("div");
  document.body.append(root);
});
afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = "";
});

function mount(component: Component, props: Record<string, unknown> = {}) {
  app = createApp({ render: () => h(component, props) });
  app.mount(root);
}
const $ = (id: string) => root.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const click = async (id: string) => {
  const element = $(id);
  if (!element) throw new Error(`no ${id}`);
  element.click();
  await settle();
};
const status = (id: string) => $(id)?.getAttribute("data-status");

const module = (id: string): CatalogModuleView =>
  ({ id, name: `Module ${id}`, version: "1.0.0", size: 0, publishedAt: "2020-01-01", owner: "abcdefgh", publisher: null, description: null, icon: false, installs: 0, rating: null, fits: true, forGames: [], screenshots: 0, homepage: null, support: null, permissions: { network: [], connectors: [], folders: [] } }) as unknown as CatalogModuleView;
const list = (...ids: string[]): CatalogListResult => ({ status: "ok", modules: ids.map(module) }) as unknown as CatalogListResult;

describe("the catalog list", () => {
  it("a load that threw ends as failed, and Try again loads again", async () => {
    host.api.browseCatalog.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(list("one"));
    mount(CatalogBrowse, { query: "" });
    await settle();
    expect(status("catalog-results")).toBe("failed");
    expect($("catalog-unreachable")).not.toBeNull();
    await click("catalog-retry");
    expect(host.api.browseCatalog).toHaveBeenCalledTimes(2);
    expect(status("catalog-results")).toBe("idle");
    expect($("catalog-one")).not.toBeNull();
  });
});

describe("a catalog module's page", () => {
  it("a page that could not be loaded ends as failed, and Try again loads it again", async () => {
    host.api.catalogPage.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ status: "ok", module: module("one"), screenshots: [], readme: [], versions: [] });
    mount(CatalogModuleDialog, { module: module("one"), installed: false });
    await settle();
    expect(status("catalog-info-one")).toBe("failed");
    await click("catalog-info-retry");
    expect(host.api.catalogPage).toHaveBeenCalledTimes(2);
    expect(status("catalog-info-one")).toBe("idle");
    expect($("catalog-info-missing")).toBeNull();
  });

});

describe("the reviews of a catalog module", () => {
  it("reviews that could not be loaded end as failed, and Try again loads them again", async () => {
    host.api.catalogReviews.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ status: "ok", rating: null, reviews: [], mine: null, can: "sign-in", installedVersion: null });
    mount(CatalogReviewsView, { moduleId: "one", moduleName: "One", publisher: null });
    await settle();
    expect(status("catalog-reviews")).toBe("failed");
    await click("catalog-reviews-retry");
    expect(host.api.catalogReviews).toHaveBeenCalledTimes(2);
    expect(status("catalog-reviews")).toBe("idle");
    expect($("catalog-reviews-none")).not.toBeNull();
  });
});

describe("a catalog icon", () => {
  it("a fetch that threw shows the fallback and does not try again", async () => {
    host.api.catalogIcon.mockRejectedValue(new Error("offline"));
    mount(CatalogIcon, { moduleId: "one", has: true });
    await settle();
    expect(status("catalog-icon-box")).toBe("failed");
    expect(host.api.catalogIcon).toHaveBeenCalledTimes(1);
  });

  it("an older icon does not land over the one for the newer id", async () => {
    const a = deferred<string | null>();
    const b = deferred<string | null>();
    host.api.catalogIcon.mockImplementation((id: string) => (id === "a" ? a.promise : b.promise));
    const id = ref("a");
    app = createApp({ render: () => h(CatalogIcon, { moduleId: id.value, has: true }) });
    app.mount(root);
    await settle();
    id.value = "b";
    await settle();
    b.resolve("data:image/png;base64,BBB");
    await settle();
    a.resolve("data:image/png;base64,AAA");
    await settle();
    expect(root.innerHTML).not.toContain("AAA");
  });
});

describe("contact the developer", () => {
  it("a draft that could not be loaded ends as failed, and Try again loads it again", async () => {
    host.api.contactDraft.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ status: "signed-out" });
    mount(ContactDeveloperDialog, { moduleId: "one", moduleName: "One" });
    await settle();
    expect(status("frame")).toBe("failed");
    await click("contact-retry");
    expect(host.api.contactDraft).toHaveBeenCalledTimes(2);
    expect($("contact-sign-in")).not.toBeNull();
  });
});

describe("a busy button is usable again after the work throws", () => {
  it("prompt: a submit that threw shows an error and the button works again", async () => {
    const submit = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce("Name taken.");
    const request: PromptRequest = { kind: "prompt", title: "Rename", label: "Name", confirm: "Save", value: "x", maxLength: 80, submit };
    mount(PromptDialog, { request });
    await settle();
    root.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();
    expect(status("frame")).toBe("failed");
    expect(($("prompt-submit") as HTMLButtonElement).disabled).toBe(false);
    expect($("prompt-error")).not.toBeNull();
    root.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();
    expect(submit).toHaveBeenCalledTimes(2);
    expect($("prompt-error")?.textContent).toBe("Name taken.");
  });

  it("profile: a save that threw does not block the next one", async () => {
    host.act.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce({ ok: true });
    const editor = shallowRef<{ save(): Promise<void> } | null>(null);
    const draft = ref({ name: "Grace", initials: "G" });
    app = createApp({ render: () => h(ProfileEditor, { ref: editor, draft: draft.value, "onUpdate:draft": (value: { name: string; initials: string }) => (draft.value = value) }) });
    app.mount(root);
    await settle();
    await editor.value!.save();
    expect(root.firstElementChild?.getAttribute("data-status")).toBe("failed");
    await editor.value!.save();
    expect(host.act).toHaveBeenCalledTimes(2);
    expect(root.firstElementChild?.getAttribute("data-status")).toBe("idle");
  });
});
