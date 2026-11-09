// @vitest-environment jsdom
// A dialog that waits for work closes only itself when the work ends (CLAUDE.md "State"): a dialog shown meanwhile, such
// as a consent a module asked for, stays, and is not answered for the user. The real host.ts runs (its slot, queue and
// closeDialog) on a stand-in for the main process: `act` answers when the test says so.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, h, nextTick, shallowRef, type App, type Component } from "vue";
import type { ActionResult, HostAction, HostViewState } from "../../shared/host-api";

const bridge = vi.hoisted(() => {
  const act = vi.fn<(action: HostAction) => Promise<ActionResult>>(async () => ({ ok: true }));
  // Every listener is taken and never called, every other call answers nothing: the test drives the slot and the state itself.
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

import { account, dialog, state, type GrantRequest, type PromptRequest, type ShareIconsRequest } from "../host";
import AddPersonalDialog from "./AddPersonalDialog.vue";
import CopyExampleDialog from "./developer/CopyExampleDialog.vue";
import GrantDialog from "./GrantDialog.vue";
import PromptDialog from "./PromptDialog.vue";
import ShareIconsDialog from "./ShareIconsDialog.vue";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((ok) => (resolve = ok));
  return { promise, resolve };
}
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const MODULE = "community.notes";
/** Just enough of the host's state for these dialogs: one module that asks for a site, and one example to copy. */
function hostState(): HostViewState {
  const module = (id: string) => ({ id, name: "Notes", version: "1.0.0", provenance: "local", origin: { kind: "catalog" }, publisher: null, permissions: { asks: { network: ["example.com"], connectors: [], folders: [] }, missing: { network: ["example.com"], connectors: [], folders: [] } } });
  return {
    language: { resolved: "en" },
    appearance: { themes: [], themeId: "", variationId: "" },
    library: { onboarded: false, workspaces: { w1: { id: "w1", name: "Valheim", shareIcon: "data:image/png;base64,AA" } } },
    modules: [module(MODULE), module("local.example.vue-module")],
    panels: [],
    developmentFolders: [],
  } as unknown as HostViewState;
}

let app: App | undefined;
let root: HTMLElement;
beforeEach(() => {
  bridge.act.mockReset();
  bridge.act.mockResolvedValue({ ok: true });
  state.value = hostState();
  root = document.createElement("div");
  document.body.append(root);
});
afterEach(async () => {
  app?.unmount();
  app = undefined;
  // A connector question that ended is dropped from the queue, as the host does when main no longer asks it.
  state.value = hostState();
  await nextTick();
  dialog.value = null;
  document.body.innerHTML = "";
});

/** Mounts `component` as App.vue does: in the slot, with the request shown now (props follow the slot, as `:request="dialog"`). */
function mount(component: Component, props: () => Record<string, unknown> = () => ({})) {
  app = createApp({ render: () => h(component, props()) });
  app.mount(root);
}
const button = (id: string) => root.querySelector(`[data-testid="${id}"]`) as HTMLElement;
async function submit(input: string, value: string) {
  const field = root.querySelector(`[data-testid="${input}"]`) as HTMLInputElement;
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
  await settle();
  root.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await settle();
}
/** The first `act` of `type` waits until the test answers it; the rest answer ok at once. */
function holdAct(type: HostAction["type"]) {
  const answer = deferred<ActionResult>();
  bridge.act.mockImplementation(async (action) => (action.type === type ? answer.promise : { ok: true }));
  return answer;
}

/**
 * A question shown while the first dialog waited: another module's consent, opened by the user (a question the host asks
 * on its own waits behind a dialog the user is working in, dialog-queue.ts, so it comes up only once that one was closed).
 */
const consent: GrantRequest = { kind: "grant", moduleId: "community.other", slot: null, review: true };

describe("a dialog that waits closes only itself", () => {
  it("prompt: a dialog shown while the answer was saved stays", async () => {
    const saved = deferred<string | null>();
    const request: PromptRequest = { kind: "prompt", title: "Rename", label: "Name", confirm: "Save", value: "", maxLength: 80, submit: () => saved.promise };
    dialog.value = request;
    mount(PromptDialog, () => ({ request }));
    await submit("prompt-input", "New name");
    dialog.value = consent;
    saved.resolve(null);
    await settle();
    expect(dialog.value).toBe(consent);
  });

  it("prompt: still closes itself when nothing else came", async () => {
    const request: PromptRequest = { kind: "prompt", title: "Rename", label: "Name", confirm: "Save", value: "", maxLength: 80, submit: async () => null };
    dialog.value = request;
    mount(PromptDialog, () => ({ request }));
    await submit("prompt-input", "New name");
    expect(dialog.value).toBeNull();
  });

  it("personal workspace: a dialog shown while it was added stays", async () => {
    const added = holdAct("add-workspace");
    dialog.value = { kind: "add-personal" };
    mount(AddPersonalDialog);
    await submit("personal-name", "Reading");
    dialog.value = consent;
    added.resolve({ ok: true, id: "w2" });
    await settle();
    expect(dialog.value).toBe(consent);
  });

  it("personal workspace: still closes itself when nothing else came", async () => {
    bridge.act.mockResolvedValue({ ok: true, id: "w2" });
    dialog.value = { kind: "add-personal" };
    mount(AddPersonalDialog);
    await submit("personal-name", "Reading");
    expect(dialog.value).toBeNull();
  });

  it("copy an example: a dialog shown while it was copied stays, and it closes itself when nothing came", async () => {
    const copied = holdAct("copy-example");
    dialog.value = { kind: "copy-example", moduleId: "local.example.vue-module" };
    mount(CopyExampleDialog, () => ({ moduleId: "local.example.vue-module" }));
    await submit("copy-example-name", "My notes");
    dialog.value = consent;
    copied.resolve({ ok: true, id: "C:\\Projects\\my-notes" });
    await settle();
    expect(dialog.value).toBe(consent);

    app!.unmount();
    bridge.act.mockResolvedValue({ ok: true, id: "C:\\Projects\\my-notes" });
    dialog.value = { kind: "copy-example", moduleId: "local.example.vue-module" };
    mount(CopyExampleDialog, () => ({ moduleId: "local.example.vue-module" }));
    await submit("copy-example-name", "My notes");
    expect(dialog.value).toBeNull();
  });

  it("share icons: a dialog shown while they were sent stays, and it closes itself when nothing came", async () => {
    const shared = holdAct("share-icons");
    const request: ShareIconsRequest = { kind: "share-icons", workspaceIds: ["w1"] };
    account.value = { account: { id: "u1" } } as unknown as typeof account.value;
    dialog.value = request;
    mount(ShareIconsDialog, () => ({ request }));
    await settle();
    button("share-icons-submit").click();
    await settle();
    dialog.value = consent;
    shared.resolve({ ok: true, shared: 1 });
    await settle();
    expect(dialog.value).toBe(consent);

    app!.unmount();
    bridge.act.mockResolvedValue({ ok: true, shared: 1 });
    dialog.value = request;
    mount(ShareIconsDialog, () => ({ request }));
    await settle();
    button("share-icons-submit").click();
    await settle();
    expect(dialog.value).toBeNull();
  });
});

describe("the consent dialog answers only the question it showed", () => {
  const grant: GrantRequest = { kind: "grant", moduleId: MODULE, slot: null, review: true };

  it("another module's question shown while the access was saved stays, unanswered", async () => {
    const saved = holdAct("grant-module");
    dialog.value = grant;
    mount(GrantDialog, () => ({ request: grant }));
    await settle();
    button("grant-allow").click();
    await settle();
    dialog.value = consent;
    saved.resolve({ ok: true });
    await settle();
    expect(dialog.value).toBe(consent);
    expect(bridge.act.mock.calls.map(([action]) => action.type)).toEqual(["grant-module"]);
  });

  it("this module's next question, shown in the same dialog while the access was saved, stays, unanswered", async () => {
    // App.vue keys the dialog by module, so the next question of the same module comes in as new props.
    const saved = holdAct("grant-module");
    const next: GrantRequest = { kind: "grant", moduleId: MODULE, slot: null, review: true, onRequest: { id: 9, connectors: ["media"] } };
    const shown = shallowRef<GrantRequest>(grant);
    dialog.value = grant;
    mount(GrantDialog, () => ({ request: shown.value }));
    await settle();
    button("grant-allow").click();
    await settle();
    dialog.value = next;
    shown.value = next;
    await nextTick();
    saved.resolve({ ok: true });
    await settle();
    expect(dialog.value).toBe(next);
    // Nobody said no to the question the user hasn't seen yet.
    expect(bridge.act.mock.calls.map(([action]) => action)).toEqual([expect.objectContaining({ type: "grant-module", moduleId: MODULE })]);
  });

  it("a connector question: a dialog shown while the answer was saved stays", async () => {
    const answered = holdAct("connector-answer");
    // Main asks, and the host shows the question in the window.
    state.value = { ...hostState(), pendingConnector: { id: 3, moduleId: MODULE, connectors: ["media"] } } as HostViewState;
    await settle();
    const asked = dialog.value as GrantRequest;
    expect(asked).toMatchObject({ kind: "grant", moduleId: MODULE, onRequest: { id: 3 } });
    mount(GrantDialog, () => ({ request: asked }));
    await settle();
    button("grant-allow").click();
    await settle();
    dialog.value = consent;
    answered.resolve({ ok: true });
    await settle();
    expect(dialog.value).toBe(consent);
  });

  it("still closes itself when nothing else came", async () => {
    dialog.value = grant;
    mount(GrantDialog, () => ({ request: grant }));
    await settle();
    button("grant-allow").click();
    await settle();
    expect(dialog.value).toBeNull();
  });
});
