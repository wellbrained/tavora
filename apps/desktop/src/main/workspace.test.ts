import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { SavedLayout } from "./layout";
import { emptyWorkspace, loadWorkspace, planSnapshot, saveWorkspace, settlePanelTypes, type Snapshot } from "./workspace";

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
      emptyWorkspace(["poe2", "satisfactory"]),
    );
  });

  it("reads a version 1 file, which has panels but no layout", async () => {
    const file = await tempFile();
    await writeFile(file, JSON.stringify({ version: 1, games: { poe2: { instances: [{ instanceId: A, moduleId: "local.example.a" }] } } }));
    const state = await loadWorkspace(file, ["poe2"], () => true);
    expect(state.games.poe2).toEqual({ instances: [{ instanceId: A, moduleId: "local.example.a" }], layout: null, snapshots: [] });
  });

  it("round-trips and drops unknown games, missing modules and bad records", async () => {
    const file = await tempFile();
    const snapshot: Snapshot = {
      id: S,
      name: "Mapping",
      savedAt: "2026-10-14T12:00:00.000Z",
      layout: twoColumns(A, C),
      modules: { [A]: "local.example.a", [C]: "local.example.gone" },
    };
    await saveWorkspace(file, {
      version: 2,
      games: {
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
    expect(Object.keys(state.games)).toEqual(["poe2", "satisfactory"]);
    const poe2 = state.games.poe2!;
    expect(poe2.instances).toEqual([{ instanceId: A, moduleId: "local.example.a" }]);
    // The panel of the missing module leaves the layout.
    expect(poe2.layout!.root.children).toEqual([{ kind: "group", size: 500, panels: [A], active: A }]);
    // So does the snapshot's placeholder for it; the broken snapshot is dropped.
    expect(poe2.snapshots).toHaveLength(1);
    expect(poe2.snapshots[0]!.modules).toEqual({ [A]: "local.example.a" });
    expect(state.games.satisfactory!.instances).toEqual([]);
  });

  it("keeps a panel's type, and drops one that is not a type id", async () => {
    const file = await tempFile();
    const snapshot = { id: S, name: "Plan", savedAt: "2026-10-17T12:00:00.000Z", layout: twoColumns(A, B), modules: { [A]: "m.a", [B]: "m.a" }, panelTypes: { [A]: "planner", [B]: "../x" } };
    await writeFile(
      file,
      JSON.stringify({
        version: 2,
        games: { poe2: { instances: [{ instanceId: A, moduleId: "m.a", panelType: "planner" }, { instanceId: B, moduleId: "m.a", panelType: "Bad Type" }], layout: null, snapshots: [snapshot] } },
      }),
    );
    const poe2 = (await loadWorkspace(file, ["poe2"], () => true)).games.poe2!;
    expect(poe2.instances).toEqual([{ instanceId: A, moduleId: "m.a", panelType: "planner" }, { instanceId: B, moduleId: "m.a" }]);
    expect(poe2.snapshots[0]!.panelTypes).toEqual({ [A]: "planner" });
  });

  it("ignores an unreadable file", async () => {
    const file = await tempFile();
    await writeFile(file, "{oops");
    expect(await loadWorkspace(file, ["poe2"], () => true)).toEqual(emptyWorkspace(["poe2"]));
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
    const state = emptyWorkspace(["poe2"]);
    state.games.poe2!.instances = [
      { instanceId: A, moduleId: "m.typed" },
      { instanceId: B, moduleId: "m.typed", panelType: "removed" },
      { instanceId: C, moduleId: "m.plain", panelType: "planner" },
    ];
    state.games.poe2!.snapshots = [{ ...snapshot, modules: { [A]: "m.typed", [B]: "m.plain" }, panelTypes: { [B]: "planner" } }];
    settlePanelTypes(state, (id) => (id === "m.typed" ? { ids: ["inventory", "planner"], continuing: "planner" } : { ids: [], continuing: null }));
    expect(state.games.poe2!.instances).toEqual([
      { instanceId: A, moduleId: "m.typed", panelType: "planner" },
      { instanceId: B, moduleId: "m.typed", panelType: "removed" },
      { instanceId: C, moduleId: "m.plain" },
    ]);
    expect(state.games.poe2!.snapshots[0]!.panelTypes).toEqual({ [A]: "planner" });
  });
});
