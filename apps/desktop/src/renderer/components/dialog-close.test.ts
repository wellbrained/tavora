// @vitest-environment jsdom
// A dialog that waits for work closes only itself when the work ends (CLAUDE.md "State"): a dialog shown meanwhile, such
// as a consent a module asked for, stays. The host's slot is replaced by a plain one with the same closeDialog rule.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, h, type App, type Component } from "vue";

const host = vi.hoisted(() => ({ act: vi.fn(), state: { value: { library: { onboarded: false } } } }));
vi.mock("../host", async () => {
  const { shallowRef } = await import("vue");
  const dialog = shallowRef<unknown>(null);
  return {
    ...host,
    dialog,
    closeDialog: (request: unknown) => {
      if (request && dialog.value === request) dialog.value = null;
    },
  };
});
// The dialog frame and its buttons as plain elements, so the test needs no popups.
vi.mock("./ModalDialog.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return { default: defineComponent({ setup: (_, { slots }) => () => h("div", slots.default?.()) }) };
});
vi.mock("@tavora/official-ui/components/ui/dialog", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    DialogFooter: defineComponent({ setup: (_, { slots }) => () => h("div", slots.default?.()) }),
    DialogButton: defineComponent({ props: { type: String }, setup: (props, { slots }) => () => h("button", { type: props.type ?? "button" }, slots.default?.()) }),
  };
});

import { dialog, type GrantRequest, type PromptRequest } from "../host";
import AddPersonalDialog from "./AddPersonalDialog.vue";
import PromptDialog from "./PromptDialog.vue";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((ok) => (resolve = ok));
  return { promise, resolve };
}
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

let app: App | undefined;
let root: HTMLElement;
beforeEach(() => {
  host.act.mockReset();
  root = document.createElement("div");
  document.body.append(root);
});
afterEach(() => {
  app?.unmount();
  app = undefined;
  dialog.value = null;
  document.body.innerHTML = "";
});

function mount(component: Component, props: Record<string, unknown> = {}) {
  app = createApp({ render: () => h(component, props) });
  app.mount(root);
}
async function submit(input: string, value: string) {
  const field = root.querySelector(`[data-testid="${input}"]`) as HTMLInputElement;
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
  await settle();
  root.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await settle();
}

/** A question that came up while the first dialog waited. */
const consent: GrantRequest = { kind: "grant", moduleId: "a.module", slot: null, review: false };

describe("a dialog that waits closes only itself", () => {
  it("prompt: a dialog shown while the answer was saved stays", async () => {
    const saved = deferred<string | null>();
    const request: PromptRequest = { kind: "prompt", title: "Rename", label: "Name", confirm: "Save", value: "", maxLength: 80, submit: () => saved.promise };
    dialog.value = request;
    mount(PromptDialog, { request });
    await submit("prompt-input", "New name");
    dialog.value = consent;
    saved.resolve(null);
    await settle();
    expect(dialog.value).toBe(consent);
  });

  it("prompt: still closes itself when nothing else came", async () => {
    const request: PromptRequest = { kind: "prompt", title: "Rename", label: "Name", confirm: "Save", value: "", maxLength: 80, submit: async () => null };
    dialog.value = request;
    mount(PromptDialog, { request });
    await submit("prompt-input", "New name");
    expect(dialog.value).toBeNull();
  });

  it("personal workspace: a dialog shown while it was added stays", async () => {
    const added = deferred<{ ok: true; id: string }>();
    host.act.mockReturnValueOnce(added.promise);
    dialog.value = { kind: "add-personal" };
    mount(AddPersonalDialog);
    await submit("personal-name", "Reading");
    dialog.value = consent;
    added.resolve({ ok: true, id: "w1" });
    await settle();
    expect(dialog.value).toBe(consent);
  });

  it("personal workspace: still closes itself when nothing else came", async () => {
    host.act.mockResolvedValueOnce({ ok: true, id: "w1" });
    dialog.value = { kind: "add-personal" };
    mount(AddPersonalDialog);
    await submit("personal-name", "Reading");
    expect(dialog.value).toBeNull();
  });
});
