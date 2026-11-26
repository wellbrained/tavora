// @vitest-environment jsdom
// The publish review is sent again by the main process on every change: the version the developer picked and the new
// module id they are typing stay, and only a new suggestion replaces them. The host is a fake.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, type App } from "vue";

vi.mock("../../host", async () => {
  const { shallowRef } = await import("vue");
  return { account: shallowRef(null), act: vi.fn(async () => ({ ok: true })), dialog: shallowRef(null), publish: shallowRef(null), settingsOpen: shallowRef(false), showToast: vi.fn() };
});
const plain = vi.hoisted(() => async () => {
  const { defineComponent, h } = await import("vue");
  return { default: defineComponent({ inheritAttrs: false, setup: (_, { slots, attrs }) => () => h("div", attrs, slots.default?.()) }) };
});
vi.mock("../ModalDialog.vue", plain);
vi.mock("../ModuleDescription.vue", plain);
vi.mock("@tavora/official-ui/components/ui/dialog", async () => ({ DialogButton: (await plain()).default, DialogFooter: (await plain()).default }));
vi.mock("@tavora/official-ui/components/ui/button", async () => ({ Button: (await plain()).default }));
vi.mock("@tavora/official-ui/components/ui/label", async () => ({ Label: (await plain()).default }));
vi.mock("@tavora/official-ui/components/ui/textarea", async () => ({ Textarea: (await plain()).default }));
// The radio group as buttons that pick a version, showing the one picked.
vi.mock("@tavora/official-ui/components/ui/radio-group", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    RadioGroupItem: (await plain()).default,
    RadioGroup: defineComponent({
      props: { modelValue: String },
      emits: ["update:modelValue"],
      setup: (props, { emit, slots }) => () => h("div", { "data-testid": "version", "data-value": props.modelValue }, [h("button", { "data-testid": "pick-minor", onClick: () => emit("update:modelValue", "1.1.0") }), slots.default?.()]),
    }),
  };
});

import { account, act, publish } from "../../host";
import PublishDialog from "./PublishDialog.vue";

const settle = async () => {
  for (let i = 0; i < 3; i++) await new Promise<void>((resolve) => setTimeout(resolve, 0));
};
const view = (extra: object) => ({
  project: "p",
  status: "ready",
  module: { id: "dev.notes", name: "Notes", version: "1.0.0", icon: null },
  notes: [],
  asks: { network: [], connectors: [], folders: [] },
  size: null,
  builtAt: null,
  sourceNewer: false,
  catalog: { kind: "first" },
  readme: null,
  problems: [],
  newPrefix: null,
  ownPrefix: null,
  error: null,
  published: null,
  ...extra,
});
const set = (value: unknown) => ((publish as { value: unknown }).value = value);

let app: App | undefined;
let root: HTMLElement;
const mount = async () => {
  root = document.createElement("div");
  document.body.append(root);
  app = createApp(defineComponent({ render: () => h(PublishDialog) }));
  app.mount(root);
  await settle();
};
afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = "";
});
beforeEach(() => set(null));

describe("PublishDialog", () => {
  it("keeps the version picked when the review is sent again", async () => {
    const problem = () => [{ kind: "version", listed: "1.0.0", next: { patch: "1.0.1", minor: "1.1.0", major: "2.0.0" } }];
    set(view({ problems: problem() }));
    await mount();
    expect((root.querySelector('[data-testid="version"]') as HTMLElement).dataset.value).toBe("1.0.1");
    (root.querySelector('[data-testid="pick-minor"]') as HTMLElement).click();
    await settle();
    set(view({ problems: problem() }));
    await settle();
    expect((root.querySelector('[data-testid="version"]') as HTMLElement).dataset.value).toBe("1.1.0");
  });

  it("keeps the new id being typed when the review is sent again", async () => {
    const problem = () => [{ kind: "prefix", prefix: "bad" }];
    set(view({ problems: problem(), ownPrefix: "alex" }));
    await mount();
    const input = root.querySelector('[data-testid="publish-id-input"]') as HTMLInputElement;
    expect(input.value).toBe("alex.notes");
    input.value = "alex.my-notes";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    set(view({ problems: problem(), ownPrefix: "alex" }));
    await settle();
    expect((root.querySelector('[data-testid="publish-id-input"]') as HTMLInputElement).value).toBe("alex.my-notes");
  });

  it("uses a prefix the account holds at once, and says why Publish is off", async () => {
    (account as { value: unknown }).value = { prefixes: { held: [{ prefix: "alex", claimedAt: 1, published: false }], max: 3 }, prefixCheck: null };
    set(view({ module: { id: "local.notes", name: "Notes", version: "1.0.0", icon: null }, problems: [{ kind: "prefix", prefix: "local", state: "reserved" }], ownPrefix: "alex" }));
    await mount();
    const text = (id: string) => root.querySelector(`[data-testid="${id}"]`)?.textContent ?? "";
    expect(text("publish-problem-prefix")).toContain("local.notes uses the reserved prefix local");
    expect(text("publish-id-state")).toBe("alex is yours.");
    expect(text("publish-id-button")).toBe("Use it");
    expect(root.querySelector('[data-testid="publish-upload"]')?.getAttribute("disabled-reason")).toBe("Give the module an id with your prefix first.");
    (root.querySelector('[data-testid="publish-id-button"]') as HTMLElement).click();
    root.querySelector("form")?.dispatchEvent(new Event("submit", { cancelable: true }));
    await settle();
    expect(act).toHaveBeenCalledWith({ type: "publish-set-id", id: "alex.notes" });
    (account as { value: unknown }).value = null;
  });

  it("checks a prefix the account doesn't hold yet", async () => {
    set(view({ module: { id: "local.notes", name: "Notes", version: "1.0.0", icon: null }, problems: [{ kind: "prefix", prefix: "local", state: "reserved" }], ownPrefix: "alex" }));
    await mount();
    expect(root.querySelector('[data-testid="publish-id-button"]')?.textContent).toBe("Check");
    expect(root.querySelector('[data-testid="publish-id-state"]')).toBeNull();
  });
});
