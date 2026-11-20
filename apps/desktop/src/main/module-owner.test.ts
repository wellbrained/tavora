import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sameOwner, settlePanelOwner, viewsOfAnotherOwner } from "./module-owner";
import { PanelStateStore } from "./storage";
import { loadWorkspace, noteOwners, saveWorkspace } from "./workspace";

const catalog = { owner: "k1", manifest: { id: "x" } };
const local = { owner: "local", manifest: { id: "x" } };

describe("sameOwner", () => {
  it("finds the copy installed now when it is the same owner's", () => {
    const now = { ...catalog };
    expect(sameOwner(catalog, new Map([["x", now]]))).toBe(now);
  });

  it("finds nothing once a development folder shadows the module under its id", () => {
    expect(sameOwner(catalog, new Map([["x", local]]))).toBeUndefined();
    expect(sameOwner(local, new Map([["x", catalog]]))).toBeUndefined();
  });

  it("finds nothing for a module that is gone", () => {
    expect(sameOwner(catalog, new Map())).toBeUndefined();
  });
});

describe("viewsOfAnotherOwner", () => {
  it("picks the open views whose id is installed now for another owner", () => {
    const views = [
      { moduleId: "x", owner: "k1", name: "shadowed" },
      { moduleId: "y", owner: "k1", name: "same owner" },
      { moduleId: "z", owner: "k1", name: "gone" },
    ];
    const installed = new Map([
      ["x", { owner: "local" }],
      ["y", { owner: "k1" }],
    ]);
    expect(viewsOfAnotherOwner(views, installed).map((view) => view.name)).toEqual(["shadowed"]);
  });
});

describe("a panel that starts after its module id changed hands", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });
  const OPEN = "00000000-0000-4000-8000-00000000000a";
  const CLOSED = "00000000-0000-4000-8000-00000000000b";
  const LEGACY = "00000000-0000-4000-8000-00000000000c";

  /**
   * Tavora with module x from publisher k1: a panel in the workspace shown, and two in a workspace not shown, one of them
   * with a panel-state file from before owners were noted. The tab content k1's page named is saved with each.
   */
  async function saved() {
    const dir = await mkdtemp(path.join(tmpdir(), "tavora-owner-"));
    dirs.push(dir);
    const file = path.join(dir, "workspace.json");
    const panelState = new PanelStateStore(path.join(dir, "panel-state"));
    await mkdir(path.join(dir, "panel-state"), { recursive: true });
    const content = { id: "k-doc", title: "K canary" };
    const record = (instanceId: string) => ({ instanceId, moduleId: "x", content: { ...content } });
    const state = { version: 3, workspaces: { a: { instances: [record(OPEN)], layout: null, snapshots: [] }, b: { instances: [record(CLOSED), record(LEGACY)], layout: null, snapshots: [] } } };
    await writeFile(file, JSON.stringify(state));
    // Read at a start while x is k1's: every panel is noted as k1's.
    const first = await loadWorkspace(file, ["a", "b"], () => true);
    noteOwners(first, () => "k1");
    await saveWorkspace(file, first);
    await panelState.set(CLOSED, { k: "canary" }, "k1");
    await writeFile(path.join(dir, "panel-state", `${LEGACY}.json`), JSON.stringify({ version: 1, value: { k: "legacy" } }));
    return { dir, file };
  }

  /** The new owner's page starting in a panel, as host.ts createView and launchOf give it what it reads. */
  async function start(record: { instanceId: string; owner?: string; content?: { id: string; title: string } }, owner: string, panelState: PanelStateStore) {
    const { from } = settlePanelOwner(record, owner);
    if (from !== null) await panelState.handOver(record.instanceId, from, owner);
    return { content: record.content ?? null, state: await panelState.get(record.instanceId, owner) };
  }

  it("taken over while Tavora was closed: its panels start without the content and state the other owner left", async () => {
    const { dir, file } = await saved();
    // The next start: a development folder took x (owner local) meanwhile.
    const state = await loadWorkspace(file, ["a", "b"], () => true);
    noteOwners(state, () => "local");
    const panelState = new PanelStateStore(path.join(dir, "panel-state"));
    const [closed, legacy] = state.workspaces.b!.instances;
    expect(await start(closed!, "local", panelState)).toEqual({ content: null, state: null });
    expect(await start(legacy!, "local", panelState)).toEqual({ content: null, state: null });
    // The local page writes its own state; k1's waits for it, also the one from before owners were noted.
    await panelState.set(closed!.instanceId, { local: 1 }, "local");
    await panelState.set(legacy!.instanceId, { local: 2 }, "local");
    const back = new PanelStateStore(path.join(dir, "panel-state"));
    expect(await back.get(CLOSED, "k1")).toEqual({ k: "canary" });
    expect(await back.get(LEGACY, "k1")).toEqual({ k: "legacy" });
  });

  it("from before owners were noted, with a panel state another owner saved: it starts without what that owner left", async () => {
    const { dir, file } = await saved();
    // The record names no owner (an older Tavora wrote it); its panel state says k1 saved it; x is local's now.
    const raw = JSON.parse(await readFile(file, "utf8")) as { workspaces: Record<string, { instances: Record<string, unknown>[] }> };
    for (const workspace of Object.values(raw.workspaces)) for (const record of workspace.instances) delete record.owner;
    await writeFile(file, JSON.stringify(raw));
    const state = await loadWorkspace(file, ["a", "b"], () => true);
    const panelState = new PanelStateStore(path.join(dir, "panel-state"));
    const stamps = new Map<string, string>();
    for (const id of [OPEN, CLOSED, LEGACY]) {
      const stamp = await panelState.ownerOf(id);
      if (stamp) stamps.set(id, stamp);
    }
    noteOwners(state, () => "local", (instanceId) => stamps.get(instanceId));
    const [closed, legacy] = state.workspaces.b!.instances;
    expect(closed!.owner).toBe("k1");
    expect(await start(closed!, "local", panelState)).toEqual({ content: null, state: null });
    // Nothing says whose the other one's content is: it counts as the owner's now (as before owners were noted).
    expect(legacy!.owner).toBe("local");
  });

  it("in a workspace not shown when the id changed hands: it starts without them when that workspace opens", async () => {
    const { dir, file } = await saved();
    const state = await loadWorkspace(file, ["a", "b"], () => true);
    noteOwners(state, () => "k1");
    const panelState = new PanelStateStore(path.join(dir, "panel-state"));
    // Workspace a is shown: its panel starts as k1's, keeps its content.
    const open = state.workspaces.a!.instances[0]!;
    expect((await start(open, "k1", panelState)).content).toEqual({ id: "k-doc", title: "K canary" });
    // x loads for local now (reloadModules hands over the open panel); later, workspace b opens.
    const closed = state.workspaces.b!.instances[0]!;
    expect(await start(closed, "local", panelState)).toEqual({ content: null, state: null });
    expect(closed.owner).toBe("local");
    // Started again as local's, nothing more is taken from it.
    expect(settlePanelOwner(closed, "local")).toEqual({ changed: false, from: null });
  });
});
