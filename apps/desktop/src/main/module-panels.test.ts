import { describe, expect, it } from "vitest";
import type { TavoraWorkspace } from "@tavora/sdk/protocol";
import { Installed, type InstalledModules } from "./installed-modules";
import { ModulePanels, type ReloadedView } from "./module-panels";
import type { InstalledModule, ModuleProblem } from "./registry";
import { emptyWorkspace, Workspaces, type InstanceRecord, type WorkspaceState } from "./workspace";

const NONE = { network: [], connectors: [], folders: [] };

function module(id: string, owner: string, root = `/modules/${id}`, panels?: string[]): InstalledModule {
  return {
    owner,
    root,
    provenance: owner === "local" ? "local" : "catalog",
    manifest: {
      id,
      name: id,
      version: "1.0.0",
      entry: "dist/index.html",
      games: [],
      permissions: { network: [] },
      viewport: { minWidth: 200, minHeight: 150, preferredWidth: 400, preferredHeight: 300 },
      ...(panels ? { panels: panels.map((type) => ({ id: type, name: type })) } : {}),
    },
  } as unknown as InstalledModule;
}

function found(modules: InstalledModule[], problems: ModuleProblem[] = []): InstalledModules {
  return { modules: new Map(modules.map((item) => [item.manifest.id, item])), blocked: new Map(), catalog: new Set(), info: new Map(), problems };
}

const shown: TavoraWorkspace = { id: "valheim", displayName: "Valheim", kind: "game" };

/** A ModulePanels over a real Workspaces and Installed, with the panels, pages and panel state written down. */
function setup(options: { before: InstalledModule[]; records: InstanceRecord[]; open?: string[]; missing?: (module: InstalledModule) => boolean; shownWorkspace?: TavoraWorkspace | null }) {
  const calls: string[] = [];
  const state: WorkspaceState = { version: 3, workspaces: { valheim: { ...emptyWorkspace(), instances: options.records } } };
  const workspaces = new Workspaces(state, { save: () => calls.push("workspace saved") });
  const installed = new Installed(found(options.before), (manifest) => manifest);
  const open = new Set(options.open ?? options.records.map((record) => record.instanceId));
  const awaiting = new Set<string>();
  let next: InstalledModules = found(options.before);
  const views = (): ReloadedView[] =>
    options.records
      .filter((record) => open.has(record.instanceId))
      .map((record) => ({
        instanceId: record.instanceId,
        moduleId: record.moduleId,
        owner: record.owner ?? "local",
        workspaceId: "valheim",
        reload: (current) => calls.push(`reload ${record.instanceId} from ${current?.root ?? "nothing"}`),
      }));
  const panels = new ModulePanels({
    installed,
    load: async () => next,
    grants: { missing: (subject) => (options.missing?.(subject as InstalledModule) ? { ...NONE, network: ["api.example.com"] } : NONE) },
    workspaces: {
      panels: (id) => workspaces.panels(id),
      dropMissingModules: (keep) => workspaces.dropMissingModules(keep),
      noteOwners: (ownerOf) => workspaces.noteOwners(ownerOf),
      settlePanelTypes: (typesOf) => workspaces.settlePanelTypes(typesOf),
      save: () => workspaces.save(),
      saveSoon: () => calls.push("workspace saved soon"),
    },
    panels: {
      has: (id) => open.has(id),
      close: (id) => void (open.delete(id), calls.push(`close ${id}`)),
      restart: (id) => void calls.push(`restart ${id}`),
      setAwaiting: (id) => void (awaiting.add(id), calls.push(`await ${id}`)),
      stopAwaiting: (id) => awaiting.delete(id),
      applyBounds: () => void calls.push("bounds"),
    },
    views,
    panelState: { handOver: async (id, from, to) => void calls.push(`hand over ${id} from ${from} to ${to}`) },
    shownWorkspace: () => (options.shownWorkspace === undefined ? shown : options.shownWorkspace),
    start: (record, _workspace, openedAt) => void (open.add(record.instanceId), calls.push(`start ${record.instanceId}${openedAt === undefined ? "" : " now"}`)),
    close: (id) => void (open.delete(id), calls.push(`close for good ${id}`)),
    forgetTooltips: (id) => void calls.push(`forget tooltips ${id}`),
    modulesChanged: async (restarted) => void calls.push(`modules changed${restarted ? ", restarted" : ""}`),
    looked: async () => void calls.push("looked"),
    pushState: () => void calls.push("push"),
  });
  return { panels, calls, installed, awaiting, instances: () => state.workspaces.valheim!.instances, find: (modules: InstalledModule[], problems?: ModuleProblem[]) => (next = found(modules, problems)) };
}

describe("ModulePanels", () => {
  it("restarts the open panels of a module now loaded for another owner in place, as the new owner's", async () => {
    const records: InstanceRecord[] = [{ instanceId: "map", moduleId: "wellbrained.map", owner: "abcd1234", content: { id: "meadows", title: "Meadows" } }];
    const { panels, calls, find } = setup({ before: [module("wellbrained.map", "abcd1234")], records });
    find([module("wellbrained.map", "local", "/dev/map")]);

    await panels.reload();

    // What the old owner's page left is set aside before its page closes; closing for good would forget the panel's bounds.
    expect(calls.indexOf("hand over map from abcd1234 to local")).toBeLessThan(calls.indexOf("restart map"));
    expect(calls).not.toContain("close map");
    expect(calls).not.toContain("close for good map");
    expect(calls).toContain("forget tooltips wellbrained.map");
    // The content the old page named goes, and the record names the new owner.
    expect(records[0]).toEqual({ instanceId: "map", moduleId: "wellbrained.map", owner: "local" });
    expect(calls).toContain("workspace saved soon");
    expect(calls).toContain("modules changed, restarted");
    // Their places didn't change, so the host UI sends none: the new views go where the old ones were.
    expect(calls.filter((call) => call === "bounds").length).toBeGreaterThan(0);
    expect(calls.at(-1)).toBe("looked");
  });

  it("lets restarted panels ask first when the new copy misses access, and starts waiting panels once it asks nothing", async () => {
    const records: InstanceRecord[] = [{ instanceId: "map", moduleId: "wellbrained.map", owner: "abcd1234" }];
    const asks = setup({ before: [module("wellbrained.map", "abcd1234")], records: structuredClone(records), missing: (item) => item.owner === "local" });
    asks.find([module("wellbrained.map", "local", "/dev/map")]);
    await asks.panels.reload();
    expect(asks.calls).toContain("await map");
    expect(asks.calls).not.toContain("start map now");

    const free = setup({ before: [module("wellbrained.map", "abcd1234")], records: structuredClone(records) });
    free.awaiting.add("map");
    free.find([module("wellbrained.map", "local", "/dev/map")]);
    await free.panels.reload();
    expect(free.calls).not.toContain("await map");
    // Panels that waited for the old copy's question start when the new copy asks nothing.
    expect(free.calls).toContain("start map now");
  });

  it("reloads the panels of a module now loaded from another folder, and closes those of a module that is gone", async () => {
    const records: InstanceRecord[] = [
      { instanceId: "notes", moduleId: "tavora.notes", owner: "official" },
      { instanceId: "old", moduleId: "local.old", owner: "local" },
    ];
    const { panels, calls, find, instances } = setup({ before: [module("tavora.notes", "official", "/downloaded/notes"), module("local.old", "local")], records });
    find([module("tavora.notes", "official", "/shipped/notes")]);

    const moved = await panels.reload();

    expect([...moved]).toEqual(["tavora.notes"]);
    expect(calls).toContain("reload notes from /shipped/notes");
    expect(calls).toContain("close for good old");
    expect(calls).not.toContain("restart notes");
    expect(instances().map((record) => record.instanceId)).toEqual(["notes"]);
  });

  it("keeps the panels of a module that can't load right now", async () => {
    const records: InstanceRecord[] = [{ instanceId: "map", moduleId: "local.map", owner: "local" }];
    const { panels, calls, find, instances } = setup({ before: [module("local.map", "local")], records });
    find([], [{ folder: "map", path: "/dev/map", message: "not built", kind: "notBuilt", developmentFolder: "/dev", developmentProject: "/dev/map", about: { id: "local.map", name: "Map", version: "1.0.0" } } as unknown as ModuleProblem]);

    await panels.reload();

    expect(calls).not.toContain("close for good map");
    expect(instances()).toHaveLength(1);
    // Its type is gone for now: the slot says so and the page stops.
    expect(calls).toContain("close map");
  });

  it("starts a panel whose type came back, and stops one whose type an update removed", async () => {
    const records: InstanceRecord[] = [
      { instanceId: "a", moduleId: "local.board", panelType: "board", owner: "local" },
      { instanceId: "b", moduleId: "local.board", panelType: "list", owner: "local" },
    ];
    const { panels, calls, find } = setup({ before: [module("local.board", "local", "/dev/board", ["board"])], records, open: ["a"] });
    find([module("local.board", "local", "/dev/board", ["list"])]);

    await panels.reload();

    expect(calls).toContain("close a");
    expect(calls).toContain("start b");
    expect(calls).toContain("workspace saved");
  });

  it("looks at the modules one time after another", async () => {
    const { panels, calls } = setup({ before: [], records: [] });
    await Promise.all([panels.reload(), panels.reload()]);
    expect(calls.filter((call) => call === "modules changed" || call === "looked")).toEqual(["modules changed", "looked", "modules changed", "looked"]);
  });

  it("reloads a module's pages with the copy installed now and starts its waiting panels", () => {
    const records: InstanceRecord[] = [
      { instanceId: "one", moduleId: "local.map", owner: "local" },
      { instanceId: "two", moduleId: "local.map", owner: "local" },
    ];
    const { panels, calls, awaiting } = setup({ before: [module("local.map", "local")], records, open: ["one"] });
    awaiting.add("two");

    panels.reloadViews("local.map");

    expect(calls).toEqual(["forget tooltips local.map", "reload one from /modules/local.map", "start two now", "bounds", "push"]);
  });

  it("starts no waiting panel while the module still misses access, or when no workspace is shown", () => {
    const records: InstanceRecord[] = [{ instanceId: "two", moduleId: "local.map", owner: "local" }];
    const asks = setup({ before: [module("local.map", "local")], records, open: [], missing: () => true });
    asks.awaiting.add("two");
    asks.panels.reloadViews("local.map");
    expect(asks.calls).toEqual(["forget tooltips local.map"]);

    const home = setup({ before: [module("local.map", "local")], records, open: [], shownWorkspace: null });
    home.awaiting.add("two");
    home.panels.reloadViews("local.map");
    expect(home.calls).toEqual(["forget tooltips local.map"]);
  });

  it("asks first for a module that misses access, never for a built-in one", () => {
    const browser = { ...module("tavora.browser", "official"), builtIn: true as const };
    const { panels } = setup({ before: [module("local.map", "local"), browser], records: [], missing: () => true });
    expect(panels.needsAnswer("local.map")).toBe(true);
    expect(panels.needsAnswer("tavora.browser")).toBe(false);
    expect(panels.needsAnswer("local.gone")).toBe(false);
  });

  it("gives a panel its type, null for a module without types, and nothing for a type gone or a paused Discord voice", () => {
    const { panels } = setup({ before: [module("local.board", "local", "/dev/board", ["board"]), module("local.plain", "local"), module("wellbrained.discord", "abcd1234")], records: [] });
    expect(panels.typeOf({ moduleId: "local.board", panelType: "board" })?.id).toBe("board");
    expect(panels.typeOf({ moduleId: "local.board", panelType: "list" })).toBeUndefined();
    expect(panels.typeOf({ moduleId: "local.plain" })).toBeNull();
    expect(panels.typeOf({ moduleId: "local.gone" })).toBeUndefined();
    expect(panels.typeOf({ moduleId: "wellbrained.discord" })).toBeUndefined();
  });

  it("keeps the panels of a module that left Tavora for the catalog", () => {
    const { panels } = setup({ before: [], records: [] });
    expect(panels.keepsPanels("wellbrained.ai-usage")).toBe(true);
    expect(panels.keepsPanels("local.gone")).toBe(false);
  });
});
