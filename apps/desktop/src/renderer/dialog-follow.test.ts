// @vitest-environment jsdom
// A flow that waited goes on only from the dialog it started in (CLAUDE.md "State"): what the user opened meanwhile, or a
// question that came up, stays. The real host.ts runs on a stand-in for the main process: `act` answers when the test says.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, h, nextTick, type App, type Component } from "vue";
import type { AccountView, ActionResult, DeveloperKeysView, HostAction, HostViewState } from "../shared/host-api";

const bridge = vi.hoisted(() => {
  const act = vi.fn<(action: HostAction) => Promise<ActionResult>>(async () => ({ ok: true }));
  // Every listener is taken and never called, every other call answers nothing: the test drives the state itself.
  const api = new Proxy({} as Record<string, unknown>, {
    get: (_, key) => (key === "act" ? act : typeof key === "string" && key.startsWith("on") ? () => () => undefined : () => Promise.resolve(null)),
  });
  (window as unknown as { tavoraHost: unknown }).tavoraHost = api;
  document.elementsFromPoint ??= () => [];
  if (!("PerformanceObserver" in globalThis)) (globalThis as Record<string, unknown>).PerformanceObserver = class { observe() {} disconnect() {} };
  return { act };
});
// The dialog frame as a plain element with a button that closes it (Escape, the X), so the test needs no popups.
vi.mock("./components/ModalDialog.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return { default: defineComponent({ emits: ["close"], setup: (_, { slots, emit }) => () => h("div", [h("button", { "data-testid": "frame-close", onClick: () => emit("close") }), slots.default?.()]) }) };
});
vi.mock("@tavora/official-ui/components/ui/dialog", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    DialogFooter: defineComponent({ setup: (_, { slots }) => () => h("div", slots.default?.()) }),
    // Only its own click runs: a test closes the dialog, as the kit's `close` button also does, with the frame's close.
    DialogButton: defineComponent({
      inheritAttrs: false,
      props: { type: String, close: Boolean },
      setup: (props, { slots, attrs }) => () =>
        h("button", { type: props.type ?? "button", "data-testid": attrs["data-testid"], "data-close": props.close || undefined, onClick: attrs.onClick }, slots.default?.()),
    }),
  };
});
// The welcome's screens as plain buttons for what they emit.
const screen = vi.hoisted(() => async () => {
  const { defineComponent, h } = await import("vue");
  return { default: defineComponent({ setup: () => () => h("div") }) };
});
// A screen as buttons for what it emits: `[testid, event, value]`.
const emitting = vi.hoisted(() => (buttons: Array<[string, string, unknown?]>) => async () => {
  const { defineComponent, h } = await import("vue");
  return {
    default: defineComponent({
      emits: [...new Set(buttons.map(([, event]) => event))],
      setup: (_, { emit }) => () => h("div", buttons.map(([testid, event, value]) => h("button", { "data-testid": testid, onClick: () => emit(event, value) }))),
    }),
  };
});
vi.mock("./components/onboarding/OnboardingMap.vue", emitting([["map-next", "next"]]));
vi.mock("./components/onboarding/OnboardingChoice.vue", emitting([["choice-game", "pick", "game"]]));
vi.mock("./components/onboarding/OnboardingGame.vue", emitting([["game-start", "start", { id: "g1", moduleIds: ["a.notes"] }]]));
vi.mock("./components/onboarding/OnboardingPersonal.vue", screen);
vi.mock("./components/onboarding/OnboardingAccount.vue", screen);
vi.mock("./components/ModuleIcon.vue", screen);

import { account, closeDialog, developerKeys, dialog, followDialog, publishModule, state, type DialogRequest } from "./host";
import GameSwitchDialog from "./components/GameSwitchDialog.vue";
import ModuleUpdates from "./components/ModuleUpdates.vue";
import LinkChoiceDialog from "./components/LinkChoiceDialog.vue";
import OnboardingPage from "./pages/OnboardingPage.vue";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((ok) => (resolve = ok));
  return { promise, resolve };
}
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function hostState(): HostViewState {
  return {
    language: { resolved: "en" },
    appearance: { themes: [], themeId: "", variationId: "" },
    library: { onboarded: false, workspaces: { g1: { id: "g1", name: "Valheim" } } },
    modules: [],
    panels: [],
    developmentFolders: [],
  } as unknown as HostViewState;
}
const signedIn = (publisherKeys: AccountView["publisherKeys"] = null) => ({ account: { email: "nik@example.com" }, publisherKeys, developer: null }) as unknown as AccountView;
const signedOut = () => ({ account: null, publisherKeys: null, developer: null }) as unknown as AccountView;

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
  dialog.value = null;
  account.value = null;
  developerKeys.value = null;
  await nextTick();
  document.body.innerHTML = "";
});

function mount(component: Component, props: () => Record<string, unknown> = () => ({})) {
  app = createApp({ render: () => h(component, props()) });
  app.mount(root);
}
const button = (id: string) => root.querySelector(`[data-testid="${id}"]`) as HTMLElement;
const calls = (type: HostAction["type"]) => bridge.act.mock.calls.map(([action]) => action).filter((action) => action.type === type);

describe("followDialog", () => {
  it("goes on only while the dialog it started from still shows", () => {
    const library: DialogRequest = { kind: "add-module" };
    dialog.value = library;
    followDialog(library, { kind: "developer-start" });
    expect(dialog.value?.kind).toBe("developer-start");

    const typed: DialogRequest = { kind: "prompt", title: "Rename", value: "Dun", maxLength: 80, submit: () => undefined } as unknown as DialogRequest;
    dialog.value = typed;
    followDialog(library, { kind: "developer-start" });
    expect(dialog.value).toBe(typed);
  });

  it("starts from no dialog only while none is open", () => {
    followDialog(null, { kind: "developer-start" });
    expect(dialog.value?.kind).toBe("developer-start");
    followDialog(null, { kind: "add-game" });
    expect(dialog.value?.kind).toBe("developer-start");
  });
});

describe("Publish while the developer side is still read", () => {
  it("opens the onboarding where Publish was pressed", async () => {
    account.value = signedIn();
    publishModule("dev.notes");
    await settle();
    expect(calls("account-refresh")).toHaveLength(1);
    expect(dialog.value?.kind).toBe("developer-start");
  });

  it("leaves a dialog the user opened meanwhile", async () => {
    account.value = signedIn();
    const refresh = deferred<ActionResult>();
    bridge.act.mockImplementation((action) => (action.type === "account-refresh" ? refresh.promise : Promise.resolve({ ok: true })));
    publishModule("dev.notes");
    dialog.value = { kind: "add-game" };
    refresh.resolve({ ok: true });
    await settle();
    expect(dialog.value?.kind).toBe("add-game");
  });
});

describe("the recovery key question after signing in", () => {
  it("waits for the dialog that shows, then asks", async () => {
    account.value = signedOut();
    await nextTick();
    dialog.value = { kind: "add-game" };
    account.value = signedIn();
    developerKeys.value = { status: "ask" } as DeveloperKeysView;
    await nextTick();
    expect(dialog.value?.kind).toBe("add-game");

    closeDialog(dialog.value);
    await nextTick();
    expect(dialog.value?.kind).toBe("recovery-ask");
  });

  it("is not asked again when signing in from the publishing setup, which asks it itself", async () => {
    account.value = signedOut();
    await nextTick();
    dialog.value = { kind: "developer-start" };
    account.value = signedIn();
    developerKeys.value = { status: "ask" } as DeveloperKeysView;
    await nextTick();
    closeDialog(dialog.value);
    await nextTick();
    expect(dialog.value).toBeNull();
  });

  it("is not asked again when the publishing setup took the slot from another dialog", async () => {
    account.value = signedOut();
    await nextTick();
    const library: DialogRequest = { kind: "add-module" };
    dialog.value = library;
    account.value = signedIn();
    developerKeys.value = { status: "ask" } as DeveloperKeysView;
    await nextTick();
    // Publish in the library: the setup takes its place, with no free slot in between.
    followDialog(library, { kind: "developer-start" });
    await nextTick();
    closeDialog(dialog.value);
    await nextTick();
    expect(dialog.value).toBeNull();
  });

  it("is still asked when the first read after signing in failed", async () => {
    account.value = signedOut();
    await nextTick();
    account.value = signedIn();
    developerKeys.value = { status: "offline" } as DeveloperKeysView;
    await nextTick();
    expect(dialog.value).toBeNull();
    developerKeys.value = { status: "ask" } as DeveloperKeysView;
    await nextTick();
    expect(dialog.value?.kind).toBe("recovery-ask");
  });

  it("is not asked when the key turned up meanwhile", async () => {
    account.value = signedOut();
    await nextTick();
    dialog.value = { kind: "add-game" };
    account.value = signedIn();
    developerKeys.value = { status: "ask" } as DeveloperKeysView;
    await nextTick();
    developerKeys.value = { status: "ready", keys: [] } as unknown as DeveloperKeysView;
    await nextTick();
    closeDialog(dialog.value);
    await nextTick();
    expect(dialog.value).toBeNull();
  });
});

describe("a host question answers once", () => {
  it("Cancel is the button and the dialog closing, and answers once", async () => {
    dialog.value = { kind: "link-choice", url: "https://example.com" };
    mount(LinkChoiceDialog, () => ({ url: "https://example.com" }));
    // The kit's close button runs its click and closes the dialog.
    button("link-choice-cancel").click();
    button("frame-close").click();
    await settle();
    expect(calls("link-choice")).toEqual([{ type: "link-choice", choice: "cancel" }]);
    expect(dialog.value).toBeNull();
  });

  it("answers the question shown after it was updated in place", async () => {
    dialog.value = { kind: "game-switch", gameId: "g1" };
    mount(GameSwitchDialog, () => ({ gameId: "g1" }));
    // The same question again with new details is put in the slot as a new request.
    dialog.value = { kind: "game-switch", gameId: "g1" };
    await nextTick();
    button("game-switch-confirm").click();
    await settle();
    expect(calls("game-switch")).toEqual([{ type: "game-switch", choice: "switch" }]);
  });

  it("closing it later leaves the next question alone", async () => {
    dialog.value = { kind: "link-choice", url: "https://example.com" };
    mount(LinkChoiceDialog, () => ({ url: "https://example.com" }));
    button("link-choice-panel").click();
    // The next question takes the slot before the old dialog is gone.
    dialog.value = { kind: "game-switch", gameId: "g1" };
    button("frame-close").click();
    await settle();
    expect(calls("link-choice")).toHaveLength(1);
    expect(dialog.value?.kind).toBe("game-switch");
  });
});

describe("the welcome", () => {
  it("finishes once, however often Skip is pressed", async () => {
    const onboarded = deferred<ActionResult>();
    bridge.act.mockImplementation((action) => (action.type === "set-onboarded" ? onboarded.promise : Promise.resolve({ ok: true })));
    mount(OnboardingPage);
    const main = root.querySelector('[data-testid="onboarding"]') as HTMLElement;
    expect(main.dataset.status).toBe("steps");
    button("onboarding-skip").click();
    button("onboarding-skip").click();
    await nextTick();
    expect(main.dataset.status).toBe("finishing");
    onboarded.resolve({ ok: true });
    await settle();
    expect(calls("set-onboarded")).toHaveLength(1);
  });

  it("can try again when finishing failed", async () => {
    bridge.act.mockImplementationOnce(() => Promise.reject(new Error("main went away")));
    mount(OnboardingPage);
    // The failure is reported, as any failed click is.
    const onError = vi.fn();
    app!.config.errorHandler = onError;
    button("onboarding-skip").click();
    await settle();
    expect(onError).toHaveBeenCalledOnce();
    expect((root.querySelector('[data-testid="onboarding"]') as HTMLElement).dataset.status).toBe("steps");
    button("onboarding-skip").click();
    await settle();
    expect(calls("set-onboarded")).toHaveLength(2);
  });

  it("opens the workspace and its panels once, also when trying again", async () => {
    let tries = 0;
    bridge.act.mockImplementation(async (action) => (action.type === "set-onboarded" && tries++ === 0 ? { ok: false, error: "Tavora couldn't save this." } : { ok: true }));
    mount(OnboardingPage);
    const vm = root.querySelector('[data-testid="onboarding"]') as HTMLElement;
    // A workspace made on screen 3, with a module whose panels open.
    // The screens slide: each one shows once the one before has gone.
    const press = async (id: string) => {
      for (let tries = 0; tries < 50 && !button(id); tries++) await new Promise((resolve) => setTimeout(resolve, 10));
      button(id).click();
    };
    await press("map-next");
    await press("choice-game");
    await press("game-start");
    button("onboarding-skip").click();
    await settle();
    expect(vm.dataset.status).toBe("steps");
    button("onboarding-skip").click();
    await settle();
    expect(calls("open-workspace")).toHaveLength(1);
    expect(calls("open-module")).toHaveLength(1);
    expect(calls("set-onboarded")).toHaveLength(2);
  });

  it("can try again when finishing did not get through", async () => {
    bridge.act.mockResolvedValueOnce({ ok: false, error: "Tavora couldn't save this." });
    mount(OnboardingPage);
    button("onboarding-skip").click();
    await settle();
    expect((root.querySelector('[data-testid="onboarding"]') as HTMLElement).dataset.status).toBe("steps");
    button("onboarding-skip").click();
    await settle();
    expect(calls("set-onboarded")).toHaveLength(2);
  });
});

describe("Update all", () => {
  const NONE: { network: string[]; connectors: string[]; folders: string[] } = { network: [], connectors: [], folders: [] };
  const waiting = (id: string, asks = NONE) => ({ id, name: id, version: "1.0.0", origin: { kind: "catalog" }, permissions: { asks: { ...NONE, ...asks }, missing: NONE }, update: { version: "1.1.0", asks, notes: [] } });
  beforeEach(() => {
    state.value = { ...hostState(), modules: [waiting("a.notes"), waiting("b.timer", { ...NONE, network: ["example.com"] })] } as unknown as HostViewState;
  });

  it("asks for the next update in the library it ran in", async () => {
    dialog.value = { kind: "add-module", view: "updates" };
    mount(ModuleUpdates, () => ({ query: "" }));
    button("update-all-modules").click();
    await settle();
    expect(calls("apply-module-update")).toEqual([{ type: "apply-module-update", moduleId: "a.notes", version: "1.1.0" }]);
    expect(dialog.value).toMatchObject({ kind: "grant", moduleId: "b.timer", backToUpdates: true });
  });

  it("still asks when Updates was opened again from the sidebar meanwhile", async () => {
    const installed = deferred<ActionResult>();
    bridge.act.mockImplementation((action) => (action.type === "apply-module-update" ? installed.promise : Promise.resolve({ ok: true })));
    dialog.value = { kind: "add-module", view: "updates" };
    mount(ModuleUpdates, () => ({ query: "" }));
    button("update-all-modules").click();
    await nextTick();
    // Updates from the rail while the library is open: a new request for the same library.
    dialog.value = { kind: "add-module", view: "updates" };
    installed.resolve({ ok: true });
    await settle();
    expect(dialog.value).toMatchObject({ kind: "grant", moduleId: "b.timer" });
  });

  it("asks nothing once the user left the library", async () => {
    const installed = deferred<ActionResult>();
    bridge.act.mockImplementation((action) => (action.type === "apply-module-update" ? installed.promise : Promise.resolve({ ok: true })));
    dialog.value = { kind: "add-module", view: "updates" };
    mount(ModuleUpdates, () => ({ query: "" }));
    button("update-all-modules").click();
    await nextTick();
    dialog.value = { kind: "add-game" };
    installed.resolve({ ok: true });
    await settle();
    expect(dialog.value?.kind).toBe("add-game");
  });
});
