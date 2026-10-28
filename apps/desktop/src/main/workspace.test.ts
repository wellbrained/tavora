import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { gridTemplate } from "../shared/layout-templates";
import { LAYOUT_LIMITS, layoutPanels, type SavedLayout } from "./layout";
import {
  emptyWorkspaces,
  Workspaces,
  loadWorkspace,
  MAX_SNAPSHOTS,
  planSnapshot,
  saveWorkspace,
  settlePanelTypes,
  WorkspaceError,
  type Snapshot,
  type WorkspaceState,
} from "./workspace";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";
const S = "00000000-0000-4000-8000-0000000000ff";

const twoColumns = (left: string, right: string): SavedLayout => ({
  width: 1000,
  height: 600,
  direction: "row",
  root: {
    kind: "split",
    size: 600,
    children: [
      { kind: "group", size: 500, panels: [left], active: left },
      { kind: "group", size: 500, panels: [right], active: right },
    ],
  },
});

const tempFile = async () => path.join(await mkdtemp(path.join(tmpdir(), "tavora-ws-")), "workspace.json");

describe("loadWorkspace", () => {
  it("returns an empty workspace when nothing is saved", async () => {
    expect(await loadWorkspace(await tempFile(), ["poe2", "satisfactory"], () => true)).toEqual(
      emptyWorkspaces(["poe2", "satisfactory"]),
    );
  });

  it("reads a version 1 file, which has panels but no layout", async () => {
    const file = await tempFile();
    await writeFile(file, JSON.stringify({ version: 1, workspaces: { poe2: { instances: [{ instanceId: A, moduleId: "local.example.a" }] } } }));
    const state = await loadWorkspace(file, ["poe2"], () => true);
    expect(state.workspaces.poe2).toEqual({ instances: [{ instanceId: A, moduleId: "local.example.a" }], layout: null, snapshots: [] });
  });

  it("round-trips and drops unknown workspaces, missing modules and bad records", async () => {
    const file = await tempFile();
    const snapshot: Snapshot = {
      id: S,
      name: "Mapping",
      savedAt: "2026-10-14T12:00:00.000Z",
      layout: twoColumns(A, C),
      modules: { [A]: "local.example.a", [C]: "local.example.gone" },
    };
    await saveWorkspace(file, {
      version: 3,
      workspaces: {
        poe2: {
          instances: [
            { instanceId: A, moduleId: "local.example.a" },
            { instanceId: B, moduleId: "local.example.gone" },
          ],
          layout: twoColumns(A, B),
          snapshots: [snapshot, { ...snapshot, id: "nope" }],
        },
        satisfactory: { instances: [{ instanceId: "../../x", moduleId: "local.example.a" }], layout: null, snapshots: [] },
        removed: { instances: [{ instanceId: A, moduleId: "local.example.a" }], layout: null, snapshots: [] },
      },
    });
    const state = await loadWorkspace(file, ["poe2", "satisfactory"], (id) => id === "local.example.a");
    expect(Object.keys(state.workspaces)).toEqual(["poe2", "satisfactory"]);
    const poe2 = state.workspaces.poe2!;
    expect(poe2.instances).toEqual([{ instanceId: A, moduleId: "local.example.a" }]);
    // The panel of the missing module leaves the layout.
    expect(poe2.layout!.root.children).toEqual([{ kind: "group", size: 500, panels: [A], active: A }]);
    // So does the snapshot's placeholder for it; the broken snapshot is dropped.
    expect(poe2.snapshots).toHaveLength(1);
    expect(poe2.snapshots[0]!.modules).toEqual({ [A]: "local.example.a" });
    expect(state.workspaces.satisfactory!.instances).toEqual([]);
  });

  it("keeps a panel's type, and drops one that is not a type id", async () => {
    const file = await tempFile();
    const snapshot = { id: S, name: "Plan", savedAt: "2026-10-17T12:00:00.000Z", layout: twoColumns(A, B), modules: { [A]: "m.a", [B]: "m.a" }, panelTypes: { [A]: "planner", [B]: "../x" } };
    await writeFile(
      file,
      JSON.stringify({
        version: 3,
        workspaces: { poe2: { instances: [{ instanceId: A, moduleId: "m.a", panelType: "planner" }, { instanceId: B, moduleId: "m.a", panelType: "Bad Type" }], layout: null, snapshots: [snapshot] } },
      }),
    );
    const poe2 = (await loadWorkspace(file, ["poe2"], () => true)).workspaces.poe2!;
    expect(poe2.instances).toEqual([{ instanceId: A, moduleId: "m.a", panelType: "planner" }, { instanceId: B, moduleId: "m.a" }]);
    expect(poe2.snapshots[0]!.panelTypes).toEqual({ [A]: "planner" });
  });

  it("keeps what a panel shows, and drops content that is not an id and a title", async () => {
    const file = await tempFile();
    const content = { id: "b1", title: "0.5 Ice Shot Deadeye Leveling Guide" };
    await writeFile(
      file,
      JSON.stringify({
        version: 3,
        workspaces: { poe2: { instances: [{ instanceId: A, moduleId: "m.a", content }, { instanceId: B, moduleId: "m.a", content: { id: 7, title: "x" } }], layout: null, snapshots: [] } },
      }),
    );
    const poe2 = (await loadWorkspace(file, ["poe2"], () => true)).workspaces.poe2!;
    expect(poe2.instances).toEqual([{ instanceId: A, moduleId: "m.a", content }, { instanceId: B, moduleId: "m.a" }]);
  });

  it("ignores an unreadable file", async () => {
    const file = await tempFile();
    await writeFile(file, "{oops");
    expect(await loadWorkspace(file, ["poe2"], () => true)).toEqual(emptyWorkspaces(["poe2"]));
  });
});

describe("planSnapshot", () => {
  const snapshot: Snapshot = {
    id: S,
    name: "Two notes",
    savedAt: "2026-10-14T12:00:00.000Z",
    layout: twoColumns(A, B),
    modules: { [A]: "notes", [B]: "notes" },
  };
  let next = 0;
  const newId = () => `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`;

  it("reuses the panels it was saved from", () => {
    const plan = planSnapshot(snapshot, [{ instanceId: B, moduleId: "notes" }, { instanceId: A, moduleId: "notes" }], newId);
    expect(plan.layout).toEqual(twoColumns(A, B));
    expect(plan.close).toEqual([]);
  });

  it("reuses other panels of the same module, opens what is missing and closes the rest", () => {
    next = 0;
    const plan = planSnapshot(
      snapshot,
      [
        { instanceId: C, moduleId: "notes" },
        { instanceId: B, moduleId: "todos" },
      ],
      newId,
    );
    const opened = "00000000-0000-4000-8000-000000000001";
    expect(plan.layout).toEqual(twoColumns(C, opened));
    expect(plan.instances).toEqual([
      { instanceId: C, moduleId: "notes" },
      { instanceId: opened, moduleId: "notes" },
    ]);
    expect(plan.close).toEqual([{ instanceId: B, moduleId: "todos" }]);
  });
});

describe("panel types", () => {
  const snapshot: Snapshot = {
    id: S,
    name: "Planner and inventory",
    savedAt: "2026-10-17T12:00:00.000Z",
    layout: twoColumns(A, B),
    modules: { [A]: "m.a", [B]: "m.a" },
    panelTypes: { [A]: "planner", [B]: "inventory" },
  };

  it("reuses only panels of the same type and opens the type that is missing", () => {
    let next = 0;
    const newId = () => `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`;
    const plan = planSnapshot(snapshot, [{ instanceId: C, moduleId: "m.a", panelType: "planner" }, { instanceId: B, moduleId: "m.a", panelType: "planner" }], newId);
    const opened = "00000000-0000-4000-8000-000000000001";
    expect(plan.instances).toEqual([
      { instanceId: C, moduleId: "m.a", panelType: "planner" },
      { instanceId: opened, moduleId: "m.a", panelType: "inventory" },
    ]);
    expect(plan.close).toEqual([{ instanceId: B, moduleId: "m.a", panelType: "planner" }]);
  });

  it("gives older panels the continuing type, keeps removed types and clears types of modules without them", () => {
    const state = emptyWorkspaces(["poe2"]);
    state.workspaces.poe2!.instances = [
      { instanceId: A, moduleId: "m.typed" },
      { instanceId: B, moduleId: "m.typed", panelType: "removed" },
      { instanceId: C, moduleId: "m.plain", panelType: "planner" },
    ];
    state.workspaces.poe2!.snapshots = [{ ...snapshot, modules: { [A]: "m.typed", [B]: "m.plain" }, panelTypes: { [B]: "planner" } }];
    settlePanelTypes(state, (id) => (id === "m.typed" ? { ids: ["inventory", "planner"], continuing: "planner" } : { ids: [], continuing: null }));
    expect(state.workspaces.poe2!.instances).toEqual([
      { instanceId: A, moduleId: "m.typed", panelType: "planner" },
      { instanceId: B, moduleId: "m.typed", panelType: "removed" },
      { instanceId: C, moduleId: "m.plain" },
    ]);
    expect(state.workspaces.poe2!.snapshots[0]!.panelTypes).toEqual({ [A]: "planner" });
  });

  it("keeps the types of a module it can't see right now, so a rebuild doesn't turn every panel into the first type", () => {
    const state = emptyWorkspaces(["poe2"]);
    state.workspaces.poe2!.instances = [
      { instanceId: A, moduleId: "m.typed", panelType: "planner" },
      { instanceId: B, moduleId: "m.typed", panelType: "inventory" },
    ];
    state.workspaces.poe2!.snapshots = [{ ...snapshot, modules: { [A]: "m.typed" }, panelTypes: { [A]: "planner" } }];
    settlePanelTypes(state, () => undefined);
    settlePanelTypes(state, () => ({ ids: ["inventory", "planner"], continuing: "inventory" }));
    expect(state.workspaces.poe2!.instances.map((record) => record.panelType)).toEqual(["planner", "inventory"]);
    expect(state.workspaces.poe2!.snapshots[0]!.panelTypes).toEqual({ [A]: "planner" });
  });
});

describe("Workspaces", () => {
  const D = "00000000-0000-4000-8000-00000000000d";
  /** poe2 shows notes (A) beside todos (B); satisfactory has a notes panel (C). */
  const setup = () => {
    const state: WorkspaceState = emptyWorkspaces(["poe2", "satisfactory"]);
    state.workspaces.poe2 = {
      instances: [
        { instanceId: A, moduleId: "notes" },
        { instanceId: B, moduleId: "todos" },
      ],
      layout: twoColumns(A, B),
      snapshots: [],
    };
    state.workspaces.satisfactory!.instances = [{ instanceId: C, moduleId: "notes" }];
    const saved: WorkspaceState[] = [];
    let next = 0;
    const workspaces = new Workspaces(state, {
      save: (copy) => saved.push(copy),
      newId: () => `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`,
      now: () => new Date("2026-10-20T12:00:00.000Z"),
    });
    return { state, saved, workspaces };
  };

  it("saves a copy after each change", () => {
    const { state, saved, workspaces } = setup();
    workspaces.saveLayout("poe2", twoColumns(B, A));
    expect(saved).toHaveLength(1);
    expect(saved[0]).toEqual(state);
    expect(saved[0]).not.toBe(state);
  });

  it("keeps only open panels in a saved layout, without bumping the epoch", () => {
    const { state, workspaces } = setup();
    workspaces.saveLayout("poe2", twoColumns(A, D));
    expect(layoutPanels(state.workspaces.poe2!.layout)).toEqual([A]);
    expect(workspaces.epoch).toBe(0);
  });

  it("saves, renames, updates and deletes a snapshot", () => {
    const { state, workspaces } = setup();
    const id = workspaces.saveSnapshot("poe2", "  Mapping ");
    const [snapshot] = state.workspaces.poe2!.snapshots;
    expect(snapshot).toEqual({
      id,
      name: "Mapping",
      savedAt: "2026-10-20T12:00:00.000Z",
      layout: twoColumns(A, B),
      modules: { [A]: "notes", [B]: "todos" },
      panelTypes: {},
    });
    workspaces.renameSnapshot("poe2", id, "Bossing");
    workspaces.saveLayout("poe2", twoColumns(B, A));
    workspaces.updateSnapshot("poe2", id);
    expect(state.workspaces.poe2!.snapshots[0]).toMatchObject({ name: "Bossing", layout: twoColumns(B, A) });
    workspaces.deleteSnapshot("poe2", id);
    expect(state.workspaces.poe2!.snapshots).toEqual([]);
  });

  it("refuses an empty name, a name taken in any case, a missing snapshot and an empty layout", () => {
    const { workspaces } = setup();
    expect(() => workspaces.saveSnapshot("poe2", "  ")).toThrow(WorkspaceError);
    const id = workspaces.saveSnapshot("poe2", "Mapping");
    expect(() => workspaces.saveSnapshot("poe2", "mapping")).toThrow(WorkspaceError);
    // Keeping its own name is fine.
    workspaces.renameSnapshot("poe2", id, "MAPPING");
    expect(() => workspaces.applySnapshot("poe2", S)).toThrow(WorkspaceError);
    expect(() => workspaces.saveSnapshot("satisfactory", "Empty")).toThrow(WorkspaceError);
  });

  it("holds at most MAX_SNAPSHOTS snapshots a workspace", () => {
    const { workspaces } = setup();
    for (let i = 0; i < MAX_SNAPSHOTS; i++) workspaces.saveSnapshot("poe2", `Layout ${i}`);
    expect(() => workspaces.saveSnapshot("poe2", "One more")).toThrow(WorkspaceError);
  });

  it("applies a snapshot, answering with the panels to start and to stop", () => {
    const { state, workspaces } = setup();
    const id = workspaces.saveSnapshot("poe2", "Notes only");
    workspaces.vacate("notes", "poe2");
    const before = workspaces.epoch;
    const { opened, closed } = workspaces.applySnapshot("poe2", id);
    const fresh = "00000000-0000-4000-8000-000000000002";
    expect(opened).toEqual([{ instanceId: fresh, moduleId: "notes" }]);
    expect(closed).toEqual([]);
    expect(state.workspaces.poe2!.instances.map((record) => record.instanceId)).toEqual([fresh, B]);
    expect(workspaces.epoch).toBe(before + 1);
  });

  it("vacates a module in one workspace or in all, leaving empty slots", () => {
    const { state, workspaces } = setup();
    expect(workspaces.vacate("notes", "poe2")).toEqual([A]);
    expect(state.workspaces.poe2!.layout?.root.kind === "split" && state.workspaces.poe2!.layout.root.children[0]).toMatchObject({ panels: [], active: null });
    expect(state.workspaces.satisfactory!.instances).toHaveLength(1);
    expect(workspaces.vacate("notes")).toEqual([C]);
    expect(workspaces.vacate("notes")).toEqual([]);
    expect(workspaces.epoch).toBe(2);
  });

  it("drops panels of modules that are gone, slot and all", () => {
    const { state, saved, workspaces } = setup();
    expect(workspaces.dropMissingModules((moduleId) => moduleId !== "todos")).toEqual([B]);
    expect(layoutPanels(state.workspaces.poe2!.layout)).toEqual([A]);
    expect(workspaces.dropMissingModules(() => true)).toEqual([]);
    expect(saved).toHaveLength(1);
  });

  it("opens panels up to the limit and closes them with their slot", () => {
    const { state, workspaces } = setup();
    // satisfactory already has one panel.
    for (let i = 2; i <= LAYOUT_LIMITS.panels; i++) {
      const record = { instanceId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, moduleId: "notes" };
      workspaces.openPanel("satisfactory", record);
    }
    expect(() => workspaces.openPanel("satisfactory", { instanceId: D, moduleId: "notes" })).toThrow(WorkspaceError);
    expect(workspaces.closePanel("poe2", B)).toBe(true);
    expect(workspaces.closePanel("poe2", B)).toBe(false);
    expect(layoutPanels(state.workspaces.poe2!.layout)).toEqual([A]);
  });

  it("lays the open panels out in a template, unplaced ones last", () => {
    const { state, workspaces } = setup();
    workspaces.openPanel("poe2", { instanceId: D, moduleId: "map" });
    workspaces.applyTemplate("poe2", gridTemplate(3, 1));
    expect(layoutPanels(state.workspaces.poe2!.layout)).toEqual([A, B, D]);
    expect(workspaces.epoch).toBe(1);
    expect(() => workspaces.applyTemplate("poe2", undefined)).toThrow(WorkspaceError);
  });

  it("adds and forgets workspaces", () => {
    const { state, workspaces } = setup();
    workspaces.addWorkspaces(["enshrouded"]);
    expect(state.workspaces.enshrouded).toEqual({ instances: [], layout: null, snapshots: [] });
    expect(workspaces.forgetWorkspace("poe2").map((record) => record.instanceId)).toEqual([A, B]);
    expect(state.workspaces.poe2).toBeUndefined();
    expect(workspaces.workspacesUsing("notes")).toEqual(["satisfactory"]);
  });

  it("starts a new workspace with its panels side by side, and leaves one that has panels alone", () => {
    const { state, workspaces } = setup();
    workspaces.addWorkspaces(["enshrouded"]);
    workspaces.start("enshrouded", [
      { instanceId: A, moduleId: "notes" },
      { instanceId: D, moduleId: "todos" },
    ]);
    const started = state.workspaces.enshrouded!;
    expect(started.instances.map((record) => record.instanceId)).toEqual([A, D]);
    expect(started.layout?.direction).toBe("row");
    expect(started.layout?.root.children.map((child) => child.kind === "group" && child.panels)).toEqual([[A], [D]]);

    workspaces.start("satisfactory", [{ instanceId: D, moduleId: "todos" }]);
    expect(state.workspaces.satisfactory!.instances.map((record) => record.instanceId)).toEqual([C]);
    // No starter module installed: the workspace stays empty.
    workspaces.addWorkspaces(["valheim"]);
    workspaces.start("valheim", []);
    expect(state.workspaces.valheim).toEqual({ instances: [], layout: null, snapshots: [] });
  });
});
