// @vitest-environment jsdom
// The running game card above the profile card (RunningGameButton.vue): what it offers, and that adding a running
// game happens once. The host is replaced by a fake whose answers the test gives by hand.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, type App } from "vue";
import type { HostViewState, UnlistedGame } from "../../shared/host-api";

const host = vi.hoisted(() => ({ act: vi.fn() }));
vi.mock("../host", async () => {
  const { shallowRef } = await import("vue");
  return { ...host, state: shallowRef(null) };
});
// The tooltip needs the host's floating layer; the test only looks at the button.
vi.mock("./RailTooltip.vue", async () => {
  const { defineComponent } = await import("vue");
  return { default: defineComponent({ setup: (_, { slots }) => () => slots.default?.() }) };
});

import { state } from "../host";
import RunningGameButton from "./RunningGameButton.vue";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((ok) => (resolve = ok));
  return { promise, resolve };
}
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve));
  await new Promise((resolve) => setTimeout(resolve));
};

const KINGS: UnlistedGame = { name: "9 Kings", steamAppId: 2784470, catalogId: null };
const FORTNITE = { id: "local-fortnite", name: "Fortnite" };

/** The part of the host's state the card reads. */
function setState(view: { runningGameId?: string | null; unlistedGame?: UnlistedGame | null }) {
  state.value = {
    runningGameId: view.runningGameId ?? null,
    unlistedGame: view.unlistedGame ?? null,
    library: { workspaces: { [FORTNITE.id]: FORTNITE, "local-9-kings": { id: "local-9-kings", name: "9 Kings" } } },
  } as unknown as HostViewState;
}

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
  document.body.innerHTML = "";
});

async function mount() {
  app = createApp(defineComponent({ render: () => h(RunningGameButton, { expanded: true }) }));
  app.mount(root);
  await settle();
}
const button = () => root.querySelector<HTMLButtonElement>('[data-testid="rail-running"]')!;

describe("RunningGameButton", () => {
  it("switches to a game of the library that runs", async () => {
    setState({ runningGameId: FORTNITE.id });
    host.act.mockResolvedValue({ ok: true });
    await mount();
    expect(button().dataset.status).toBe("switch");
    expect(button().getAttribute("aria-label")).toBe("Switch to game");
    button().click();
    await settle();
    expect(host.act).toHaveBeenCalledExactlyOnceWith({ type: "open-workspace", workspaceId: FORTNITE.id });
  });

  it("adds a running game that isn't in the library once, keeps its words while adding, then opens it", async () => {
    setState({ unlistedGame: KINGS });
    const adding = deferred<{ ok: boolean; id?: string }>();
    host.act.mockImplementation((action: { type: string }) => (action.type === "add-workspace" ? adding.promise : Promise.resolve({ ok: true })));
    await mount();
    expect(button().dataset.status).toBe("add");
    expect(button().getAttribute("aria-label")).toBe("Add 9 Kings");
    button().click();
    button().click();
    await settle();
    expect(button().dataset.status).toBe("adding");
    // The host already counts the added game as running before the answer comes: the words stay.
    setState({ runningGameId: "local-9-kings" });
    await settle();
    expect(button().getAttribute("aria-label")).toBe("Add 9 Kings");
    adding.resolve({ ok: true, id: "local-9-kings" });
    await settle();
    expect(host.act.mock.calls.map(([action]) => action)).toEqual([
      { type: "add-workspace", name: "9 Kings", steamAppId: 2784470 },
      { type: "open-workspace", workspaceId: "local-9-kings" },
    ]);
    // Open now, so nothing to switch to: it slides away with its last words.
    setState({});
    await settle();
    expect(button().dataset.status).toBe("add");
    expect(button().getAttribute("aria-label")).toBe("Add 9 Kings");
  });

  it("becomes the switch to the added game when it couldn't be opened", async () => {
    setState({ unlistedGame: KINGS });
    host.act.mockImplementation(async (action: { type: string }) => (action.type === "add-workspace" ? { ok: true, id: "local-9-kings" } : { ok: false, error: "Nope" }));
    await mount();
    button().click();
    setState({ runningGameId: "local-9-kings" });
    await settle();
    expect(button().dataset.status).toBe("switch");
  });
});
