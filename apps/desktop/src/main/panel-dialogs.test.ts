import { afterEach, describe, expect, it, vi } from "vitest";
import type { CheckedMenu } from "./module-menu";
import { OVERLAY_SETTINGS_DIALOG, PanelDialogs, PENDING_DIALOG_MS } from "./panel-dialogs";
import { PendingQuestions } from "./pending-questions";
import type { InstalledModule } from "./registry";

const map = { owner: "local", manifest: { id: "local.map", name: "Map" } } as unknown as InstalledModule;
const size = { width: 800, height: 600 };

function menu(...choices: string[]): CheckedMenu {
  return { request: { items: choices.map((id) => ({ id, label: id })), at: { x: 1, y: 2 } }, choices: new Set(choices) } as unknown as CheckedMenu;
}

interface Setup {
  /** Panels with a view, and which of them have their slot, are over the game or may show a menu. */
  open?: string[];
  placed?: string[];
  lent?: string[];
  noMenu?: string[];
  /** Panels of the workspace shown now. */
  shownHere?: string[];
  /** The workspace of a panel over the game; null when it is gone. */
  gameWorkspace?: string | null;
  focused?: boolean;
}

function setup(options: Setup = {}) {
  const calls: string[] = [];
  const sent: [string, unknown][] = [];
  const questions = new PendingQuestions();
  const placed = new Set(options.placed ?? options.open ?? ["map"]);
  const lent = new Set(options.lent ?? []);
  let dialog: { instanceId: string; width: number; height: number; bounds: null } | null = null;
  let inDialog: string | null = null;
  const dialogs = new PanelDialogs({
    questions,
    panels: {
      has: (id) => (options.open ?? ["map"]).includes(id),
      mayShowMenu: (id) => !(options.noMenu ?? []).includes(id),
      inDialog: (id) => inDialog === id,
      openDialogMenu: async (id) => void calls.push(`dialog menu ${id}`),
      closeDialogMenu: () => void calls.push("dialog menu closed"),
      freeze: async (open, only, seq) => void calls.push(`popups ${open ? (only ? only.join(",") || "none" : "all") : "closed"} ${seq ?? 0}`),
      prepareFreeze: (near) => void calls.push(`prepare ${near ? "near" : "all"}`),
      isLent: (id) => lent.has(id),
      isPlaced: (id) => placed.has(id),
      openDialog: (id, dialogSize, unplaced) => {
        calls.push(`dialog ${id}${unplaced ? " over page" : ""}`);
        dialog = { instanceId: id, ...dialogSize, bounds: null };
        inDialog = id;
        return true;
      },
      closeDialog: (id) => {
        calls.push(`close dialog ${id}`);
        dialog = null;
        inDialog = null;
      },
      get dialog() {
        return dialog;
      },
    },
    page: {
      send: (channel, payload) => void sent.push([channel, payload]),
      focus: () => void calls.push("focus page"),
      focused: () => options.focused ?? true,
      gone: () => false,
    },
    describe: (module) => ({ title: module.manifest.name, icon: "icon.png" }),
    closeTooltips: (id) => void calls.push(id ? `tooltips ${id}` : "tooltips"),
    focusPanel: (id) => void calls.push(`focus ${id}`),
    inShownWorkspace: (id) => (options.shownHere ?? ["map"]).includes(id),
    fromGame: {
      workspaceOf: () => (options.gameWorkspace === undefined ? "valheim" : options.gameWorkspace),
      bringBack: (workspaceId) => {
        calls.push(`back to ${workspaceId}`);
        lent.clear();
      },
    },
  });
  return { dialogs, calls, sent, questions, placed, setInDialog: (id: string | null) => (inDialog = id) };
}

afterEach(() => void vi.useRealTimers());

describe("PanelDialogs", () => {
  it("draws a module's menu in the host page and answers only with an item the module offered", async () => {
    const { dialogs, calls, sent } = setup();
    const answer = dialogs.showMenu("map", menu("rename", "delete"));
    expect(calls).toEqual(["focus page"]);
    expect(sent).toEqual([["host:module-menu", { requestId: expect.any(Number), instanceId: "map", items: expect.any(Array), at: { x: 1, y: 2 } }]]);
    const { requestId } = sent[0]![1] as { requestId: number };

    dialogs.answerMenu({ requestId: requestId + 1, id: "rename" });
    dialogs.answerMenu({ requestId, id: "something else" });
    expect(await answer).toBeNull();
    // The keyboard goes back to the panel, so Rename can take it.
    expect(calls).toEqual(["focus page", "dialog menu closed", "focus map"]);
  });

  it("answers with the item chosen, and a new menu closes the last as if nothing was chosen", async () => {
    const { dialogs, sent } = setup();
    const first = dialogs.showMenu("map", menu("rename"));
    const second = dialogs.showMenu("map", menu("delete"));
    expect(await first).toBeNull();
    expect(sent.map(([channel, payload]) => (payload === null ? `${channel} null` : channel))).toEqual(["host:module-menu", "host:module-menu null", "host:module-menu"]);
    dialogs.answerMenu({ requestId: (sent[2]![1] as { requestId: number }).requestId, id: "delete" });
    expect(await second).toBe("delete");
  });

  it("shows no menu for a panel that is gone or may not show one, and one in a dialog once its view stepped aside", async () => {
    const gone = setup({ open: [] });
    expect(await gone.dialogs.showMenu("map", menu("rename"))).toBeNull();
    const covered = setup({ noMenu: ["map"] });
    expect(await covered.dialogs.showMenu("map", menu("rename"))).toBeNull();
    expect([...gone.sent, ...covered.sent]).toEqual([]);

    const { dialogs, calls, sent, setInDialog } = setup();
    setInDialog("map");
    void dialogs.showMenu("map", menu("rename"));
    expect(calls).toEqual(["tooltips map", "dialog menu map"]);
    await Promise.resolve();
    expect(sent.map(([channel]) => channel)).toEqual(["host:module-menu"]);
  });

  it("opens a panel's dialog with the module's name and icon; a menu and the panel's tooltip go first", () => {
    const { dialogs, calls, sent } = setup();
    void dialogs.showMenu("map", menu("rename"));
    dialogs.open("map", map, size, false);
    expect(calls).toEqual(["focus page", "dialog map", "dialog menu closed", "tooltips map"]);
    expect(sent.at(-1)).toEqual(["host:panel-dialog", { instanceId: "map", title: "Map", icon: "icon.png", width: 800, height: 600, closesOnClickBeside: false }]);
  });

  it("lets a panel just added wait a moment for its slot, then opens its dialog; one that took too long misses it", () => {
    vi.useFakeTimers();
    const { dialogs, calls, placed } = setup({ placed: [] });
    dialogs.open("map", map, size);
    expect(calls).toEqual([]);
    dialogs.openPending();
    expect(calls).toEqual([]);
    placed.add("map");
    dialogs.openPending();
    expect(calls).toEqual(["dialog map", "tooltips map"]);

    const late = setup({ placed: [] });
    late.dialogs.open("map", map, size);
    vi.advanceTimersByTime(PENDING_DIALOG_MS + 1);
    late.placed.add("map");
    late.dialogs.openPending();
    expect(late.calls).toEqual([]);
    expect(late.questions.peek("dialog")).toBeUndefined();
  });

  it("opens nothing for a panel without its slot outside the workspace shown, and drops a waiting dialog it closes", () => {
    const elsewhere = setup({ placed: [], shownHere: [] });
    elsewhere.dialogs.open("map", map, size);
    expect(elsewhere.calls).toEqual(["dialog map", "tooltips map"]);

    const { dialogs, questions } = setup({ placed: [] });
    dialogs.open("map", map, size);
    dialogs.close("map");
    expect(questions.peek("dialog")).toBeUndefined();
  });

  it("brings a panel over the game back to its workspace and opens its dialog there; nothing when its workspace is gone", () => {
    const { dialogs, calls } = setup({ lent: ["map"] });
    dialogs.open("map", map, size);
    expect(calls).toEqual(["back to valheim", "dialog map", "tooltips map"]);

    const gone = setup({ lent: ["map"], gameWorkspace: null });
    gone.dialogs.open("map", map, size);
    expect(gone.calls).toEqual([]);
  });

  it("names the dialog only of the panel whose dialog is open", () => {
    const { dialogs, sent } = setup();
    dialogs.setTitle("map", "Meadows");
    expect(sent).toEqual([]);
    dialogs.open("map", map, size);
    dialogs.setTitle("map", "Meadows");
    expect(sent.at(-1)).toEqual(["host:panel-dialog-title", { instanceId: "map", title: "Meadows" }]);
  });

  it("opens Settings of an overlay's panel over the Overlay page and hands the key over once its page has connected", () => {
    vi.useFakeTimers();
    const { dialogs, calls, sent } = setup({ placed: [] });
    let connected = false;
    const asked: string[] = [];
    dialogs.openSettings("map", map, { openSettings: (key) => (asked.push(key), connected) }, "weather");
    expect(calls).toEqual(["dialog map over page", "tooltips map"]);
    expect(sent.at(-1)).toEqual(["host:panel-dialog", { instanceId: "map", title: "Map", icon: "icon.png", ...OVERLAY_SETTINGS_DIALOG, closesOnClickBeside: true }]);
    vi.advanceTimersByTime(100);
    connected = true;
    vi.advanceTimersByTime(100);
    vi.advanceTimersByTime(1000);
    expect(asked).toEqual(["weather", "weather", "weather"]);
  });

  it("stops handing the key over once the dialog closed", () => {
    vi.useFakeTimers();
    const { dialogs } = setup();
    const asked: string[] = [];
    dialogs.openSettings("map", map, { openSettings: (key) => (asked.push(key), false) }, "weather");
    dialogs.close("map");
    vi.advanceTimersByTime(PENDING_DIALOG_MS);
    expect(asked).toEqual(["weather", "weather"]);
  });

  it("takes the panel's tooltips and menu with its dialog, and gives the keyboard back to the host page only while the window has it", () => {
    const { dialogs, calls, sent } = setup();
    void dialogs.showMenu("map", menu("rename"));
    calls.length = 0;
    dialogs.closed("map");
    expect(calls).toEqual(["tooltips", "dialog menu closed", "focus page"]);
    expect(sent.slice(-2)).toEqual([["host:module-menu", null], ["host:panel-dialog", null]]);

    const behind = setup({ focused: false });
    behind.dialogs.closed("map");
    expect(behind.calls).toEqual(["tooltips"]);
    behind.dialogs.drawn("map");
    expect(behind.sent.at(-1)).toEqual(["host:panel-dialog-drawn", "map"]);
  });
});

describe("the host page's popups over the panels", () => {
  it("passes each request on to the panels, and takes pictures ahead near a place or everywhere", () => {
    const { dialogs, calls } = setup();
    dialogs.preparePopups({ x: 1, y: 2, width: 3, height: 4 });
    dialogs.popups(true, [], 1);
    dialogs.popups(true, ["map"], 2);
    dialogs.preparePopups();
    dialogs.popups(true, undefined, 3);
    dialogs.popups(false, undefined, 0);
    expect(calls).toEqual(["prepare near", "popups none 1", "popups map 2", "prepare all", "popups all 3", "popups closed 0"]);
  });
});
