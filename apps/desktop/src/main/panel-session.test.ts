import { describe, expect, it } from "vitest";
import type { GatePage } from "./panel-gate";
import { PanelSession, type PanelConnectors } from "./panel-session";
import type { ReadOnlyFiles } from "./read-only-files";
import type { InstalledModule } from "./registry";

const module = { owner: "official", root: "/nowhere", manifest: { id: "tavora.planner", version: "1.0.0", entry: "index.html", permissions: {} } } as unknown as InstalledModule;
const page: GatePage = { emit: () => undefined };

/** A session of a panel that was just clicked in, whose linked files and open dialog note what they were asked. */
function session(options: { picked?: string[]; near?: string; last?: string; failOn?: string } = {}) {
  const notes: string[] = [];
  let live: GatePage | undefined = page;
  const files = {
    directoryNear: async (id: string, up: number) => (notes.push(`near ${id} ${up}`), options.near),
    lastPickedDirectory: async () => (notes.push("last"), options.last),
    remember: async (path: string) => {
      if (path === options.failOn) throw new Error("gone");
      notes.push(`remember ${path}`);
      return { id: path, name: path };
    },
    forget: async (id: string) => void notes.push(`forget ${id}`),
  };
  const panel = new PanelSession({
    instanceId: "p1",
    module: () => module,
    workspace: { id: "w1", displayName: "Planner", kind: "personal" } as never,
    hostVersion: "0.0.0",
    connectors: { networkHosts: () => new Set(), connectors: () => new Set(), discord: { release: () => undefined } } as unknown as PanelConnectors,
    pickReadOnly: async (request) => (notes.push(`dialog ${JSON.stringify(request)}`), options.picked ?? []),
    pickGame: () => "tavora-test-game",
    readOnlyFiles: () => files as unknown as ReadOnlyFiles,
    showItemInFolder: () => undefined,
    suspended: () => false,
    page: () => live,
    runsOnlyWithGame: () => false,
    overGame: () => false,
    onNeedsTavora: () => undefined,
  });
  panel.gate.notePress();
  const context = panel.connect(() => page, new AbortController().signal);
  return { panel, context, notes, leave: () => (live = undefined) };
}

describe("PanelSession: linking files (files.pickReadOnly)", () => {
  it("opens next to a linked file when asked to, else where the user last linked one", async () => {
    const near = session({ near: "/saves", picked: [] });
    await near.context.readOnlyFiles!.pick(["sav"], false, { file: "a".repeat(32), up: 1 });
    expect(near.notes).toEqual([`near ${"a".repeat(32)} 1`, 'dialog {"extensions":["sav"],"multiple":false,"start":"/saves"}']);

    const last = session({ last: "/last", picked: [] });
    await last.context.readOnlyFiles!.pick(["sav"], true);
    expect(last.notes).toEqual(["last", 'dialog {"extensions":["sav"],"multiple":true,"start":"/last"}']);

    // Nothing to start from (and a game without known save folders): the system's dialog chooses.
    const none = session({ picked: [] });
    await none.context.readOnlyFiles!.pick(["sav"], false, { file: "b".repeat(32), up: 0 });
    expect(none.notes).toEqual([`near ${"b".repeat(32)} 0`, "last", 'dialog {"extensions":["sav"],"multiple":false}']);
  });

  it("links every chosen file, or none when one fails, and none once the page that asked has gone", async () => {
    const all = session({ picked: ["/a.sav", "/b.sav"] });
    expect(await all.context.readOnlyFiles!.pick(["sav"], true)).toEqual([
      { id: "/a.sav", name: "/a.sav" },
      { id: "/b.sav", name: "/b.sav" },
    ]);

    const broken = session({ picked: ["/a.sav", "/b.sav"], failOn: "/b.sav" });
    await expect(broken.context.readOnlyFiles!.pick(["sav"], true)).rejects.toThrow("gone");
    expect(broken.notes.slice(-2)).toEqual(["remember /a.sav", "forget /a.sav"]);

    const gone = session({ picked: ["/a.sav"] });
    gone.leave();
    expect(await gone.context.readOnlyFiles!.pick(["sav"], false)).toEqual([]);
    expect(gone.notes.some((note) => note.startsWith("remember"))).toBe(false);
  });

  it("needs a press for every pick, and opens no dialog without one", async () => {
    const { context, notes } = session({ picked: ["/a.sav"] });
    await context.readOnlyFiles!.pick(["sav"], false);
    await expect(context.readOnlyFiles!.pick(["sav"], false)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(notes.filter((note) => note.startsWith("dialog"))).toHaveLength(1);
  });
});
