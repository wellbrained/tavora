import { describe, expect, it } from "vitest";
import { TavoraError, type DocumentChange, type JsonValue, type PutDocumentParams, type TavoraSDK } from "@tavora/sdk";
import type { Plan, World } from "../contracts/plan";
import type { RepositoryChange } from "../contracts/repository";
import { sampleData } from "../data/sample";
import { DocumentRepository, FIRST_WORLD_ID } from "./repository";

interface Doc {
  id: string;
  title: string;
  revision: number;
  updatedAt: string;
  data: JsonValue;
}

/** A stand-in for the SDK's documents, with the host's revision rules. */
function fakeSdk() {
  const docs = new Map<string, Doc>();
  const listeners: ((change: DocumentChange) => void)[] = [];
  let created = 0;
  let gets = 0;
  const summary = ({ data: _data, ...rest }: Doc) => ({ ...rest, bytes: JSON.stringify(_data).length });
  const check = (id: string, ifRevision: number | undefined) => {
    const current = docs.get(id)?.revision ?? 0;
    if (ifRevision !== undefined && ifRevision !== current) {
      throw new TavoraError({ code: "CONFLICT", message: `document is at revision ${current}`, revision: current });
    }
  };
  const sdk = {
    documents: {
      list: async () => [...docs.values()].map(summary),
      get: async (id: string) => {
        gets++;
        const doc = docs.get(id);
        return doc ? { ...structuredClone(doc), bytes: 0 } : null;
      },
      put: async ({ id = `generated-${++created}`, title, data, ifRevision }: PutDocumentParams) => {
        check(id, ifRevision);
        const doc = { id, title, data: structuredClone(data), revision: (docs.get(id)?.revision ?? 0) + 1, updatedAt: new Date().toISOString() };
        docs.set(id, doc);
        return summary(doc);
      },
      delete: async (id: string, options: { ifRevision?: number } = {}) => {
        if (!docs.has(id)) return;
        check(id, options.ifRevision);
        docs.delete(id);
      },
      onChange: (fn: (change: DocumentChange) => void) => {
        listeners.push(fn);
        return () => listeners.splice(listeners.indexOf(fn), 1);
      },
    },
  } as unknown as TavoraSDK;
  return {
    sdk,
    docs,
    gets: () => gets,
    /** What another panel's change looks like to this one. */
    emit: (change: DocumentChange) => listeners.forEach((fn) => fn(change)),
    /** Stores a document as it is, the way an older or broken module could have. */
    raw: (id: string, data: JsonValue) => docs.set(id, { id, title: id, data, revision: 1, updatedAt: new Date(0).toISOString() }),
  };
}

const repository = (fake = fakeSdk(), language = "en") => ({ fake, repo: new DocumentRepository(fake.sdk, { data: sampleData, language }) });

const world = (name = "Main save", patch: Partial<World> = {}): World => ({
  format: "tavora.satisfactory.world",
  version: 1,
  name,
  unlockedAlternates: [],
  showAllAlternates: false,
  ...patch,
});

const plan = (worldId: string, patch: Partial<Plan> = {}): Plan => ({
  format: "tavora.satisfactory.plan",
  version: 1,
  name: "Screws",
  worldId,
  targets: [{ item: "Desc_IronScrew_C", perMinute: 40 }],
  fixedInputs: [{ item: "Desc_IronIngot_C", perMinute: 10 }],
  recipeChoices: { Desc_IronScrew_C: "Recipe_Alternate_Screw_C" },
  ...patch,
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("worlds", () => {
  it("creates the first world when there is none", async () => {
    const { repo } = repository();
    const first = await repo.ensureWorld();
    expect(first).toMatchObject({ id: FIRST_WORLD_ID, revision: 1, value: world("My world") });
    expect(await repo.ensureWorld()).toEqual(first);
    expect(await repo.listWorlds()).toHaveLength(1);
  });

  it("names the first world in German", async () => {
    const { repo } = repository(fakeSdk(), "de");
    expect((await repo.ensureWorld()).value.name).toBe("Meine Welt");
  });

  it("reads the language when it creates the world", async () => {
    let language = "en";
    const repo = new DocumentRepository(fakeSdk().sdk, { data: sampleData, language: () => language });
    language = "de";
    expect((await repo.ensureWorld()).value.name).toBe("Meine Welt");
  });

  it("keeps an existing world instead of adding one", async () => {
    const { repo } = repository();
    const mine = await repo.putWorld(world("Main save"));
    expect(await repo.ensureWorld()).toEqual(mine);
  });

  it("makes only one first world when two panels start together", async () => {
    const fake = fakeSdk();
    const [a, b] = await Promise.all([repository(fake).repo.ensureWorld(), repository(fake).repo.ensureWorld()]);
    expect(a.id).toBe(b.id);
    expect(fake.docs.size).toBe(1);
  });

  it("stores, reads and replaces a world with revisions", async () => {
    const { repo } = repository();
    const created = await repo.putWorld(world("  Main save  ", { unlockedAlternates: ["Recipe_Alternate_Screw_C"] }));
    expect(created.id).toMatch(/^world-/);
    expect(created.value.name).toBe("Main save");
    expect(await repo.getWorld(created.id)).toEqual(created);

    const changed = await repo.putWorld({ ...created.value, showAllAlternates: true }, { id: created.id, ifRevision: 1 });
    expect(changed.revision).toBe(2);
    expect((await repo.getWorld(created.id))?.value.showAllAlternates).toBe(true);
  });

  it("passes the SDK's CONFLICT on", async () => {
    const { repo } = repository();
    const created = await repo.putWorld(world());
    await repo.putWorld(world("Renamed"), { id: created.id, ifRevision: 1 });
    const stale = repo.putWorld(world("Lost"), { id: created.id, ifRevision: 1 });
    await expect(stale).rejects.toBeInstanceOf(TavoraError);
    await expect(stale).rejects.toMatchObject({ code: "CONFLICT", revision: 2 });
  });

  it.each([
    ["an empty name", world("   ")],
    ["a long name", world("x".repeat(101))],
    ["a damaged alternate", world("Main", { unlockedAlternates: [5 as unknown as string] })],
  ])("refuses %s", async (_, value) => {
    const { repo } = repository();
    await expect(repo.putWorld(value)).rejects.toThrow(/name|alternates/);
  });

  it("keeps alternates the game data no longer has", async () => {
    const { repo } = repository();
    const saved = await repo.putWorld(world("Main", { unlockedAlternates: ["Recipe_Gone_C"] }));
    expect((await repo.listWorlds()).map((entry) => entry.value.unlockedAlternates)).toEqual([["Recipe_Gone_C"]]);
    expect((await repo.getWorld(saved.id))?.value.unlockedAlternates).toEqual(["Recipe_Gone_C"]);
  });

  it("refuses to delete a world while a plan uses it", async () => {
    const { repo } = repository();
    const main = await repo.putWorld(world());
    const screws = await repo.putPlan(plan(main.id));
    await expect(repo.deleteWorld(main.id)).rejects.toThrow("This world still has plans");
    expect(await repo.getWorld(main.id)).not.toBeNull();

    await repo.deletePlan(screws.id);
    await repo.deleteWorld(main.id);
    expect(await repo.getWorld(main.id)).toBeNull();
  });
});

describe("plans", () => {
  it("stores, lists and replaces plans", async () => {
    const { repo } = repository();
    const main = await repo.ensureWorld();
    const b = await repo.putPlan(plan(main.id, { name: "b plan" }));
    const a = await repo.putPlan(plan(main.id, { name: "A plan" }));
    expect(b.id).toMatch(/^plan-/);
    expect((await repo.listPlans()).map((entry) => entry.value.name)).toEqual(["A plan", "b plan"]);
    expect(await repo.listWorlds()).toEqual([main]);

    const changed = await repo.putPlan({ ...a.value, targets: [{ item: "Desc_IronPlate_C", perMinute: 20 }] }, { id: a.id, ifRevision: a.revision });
    expect(await repo.getPlan(a.id)).toEqual(changed);
    expect(await repo.getWorld(a.id)).toBeNull();
  });

  it("refuses a plan without a world", async () => {
    const { repo } = repository();
    await expect(repo.putPlan(plan("world-gone"))).rejects.toThrow("world is gone");
  });

  it("refuses to delete a changed plan", async () => {
    const { repo } = repository();
    const main = await repo.ensureWorld();
    const saved = await repo.putPlan(plan(main.id));
    await repo.putPlan(saved.value, { id: saved.id, ifRevision: 1 });
    await expect(repo.deletePlan(saved.id, { ifRevision: 1 })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("stores a new plan without targets", async () => {
    const { repo } = repository();
    const main = await repo.ensureWorld();
    const saved = await repo.putPlan(plan(main.id, { targets: [], fixedInputs: [], recipeChoices: {} }));
    expect((await repo.getPlan(saved.id))?.value.targets).toEqual([]);
  });

  it("keeps stored plans with ids the game data no longer has", async () => {
    const { fake, repo } = repository();
    const main = await repo.ensureWorld();
    const gone = { ...plan(main.id), targets: [{ item: "Desc_Gone_C", perMinute: 1 }], recipeChoices: { Desc_IronScrew_C: "Recipe_Gone_C" } };
    fake.raw("plan-gone", gone as unknown as JsonValue);
    expect((await repo.listPlans()).map((entry) => entry.value)).toEqual([gone]);
    const changed = await repo.putPlan({ ...gone, name: "Renamed" }, { id: "plan-gone", ifRevision: 1 });
    expect(changed.value.targets).toEqual(gone.targets);
  });

  it("leaves out stored documents of a broken shape", async () => {
    const { fake, repo } = repository();
    const main = await repo.ensureWorld();
    const good = await repo.putPlan(plan(main.id));
    fake.raw("plan-text-rate", { ...plan(main.id), targets: [{ item: "Desc_IronPlate_C", perMinute: "1" }] } as unknown as JsonValue);
    fake.raw("plan-zero", { ...plan(main.id), targets: [{ item: "Desc_IronPlate_C", perMinute: 0 }] } as unknown as JsonValue);
    fake.raw("plan-newer", { ...plan(main.id), version: 2 } as unknown as JsonValue);
    fake.raw("world-nameless", { ...world(), name: "" } as unknown as JsonValue);
    fake.raw("something-else", { notes: [] });
    fake.raw("broken", null);
    expect((await repo.listPlans()).map((entry) => entry.id)).toEqual([good.id]);
    expect((await repo.listWorlds()).map((entry) => entry.id)).toEqual([main.id]);
    expect(await repo.getPlan("plan-zero")).toBeNull();
  });

  it("does not fetch unchanged documents again", async () => {
    const { fake, repo } = repository();
    const main = await repo.ensureWorld();
    await repo.putPlan(plan(main.id));
    const before = fake.gets();
    await repo.listPlans();
    await repo.listWorlds();
    expect(fake.gets()).toBe(before);
  });
});

describe("changes from other panels", () => {
  it("tells worlds and plans apart", async () => {
    const fake = fakeSdk();
    const { repo } = repository(fake);
    const other = repository(fake).repo;
    const seen: RepositoryChange[] = [];
    const stop = repo.onChange((change) => seen.push(change));

    const main = await other.ensureWorld();
    const screws = await other.putPlan(plan(main.id));
    fake.emit({ id: main.id, revision: 1, deleted: false });
    fake.emit({ id: screws.id, revision: 1, deleted: false });
    fake.raw("something-else", { notes: [] });
    fake.emit({ id: "something-else", revision: 1, deleted: false });
    await settle();
    await other.deletePlan(screws.id);
    fake.emit({ id: screws.id, revision: 1, deleted: true });
    await settle();

    expect(seen).toEqual([
      { kind: "world", id: main.id, deleted: false },
      { kind: "plan", id: screws.id, deleted: false },
      { kind: "plan", id: screws.id, deleted: true },
    ]);
    stop();
    fake.emit({ id: main.id, revision: 1, deleted: false });
    await settle();
    expect(seen).toHaveLength(3);
  });

  it("knows a deleted document by what it read before", async () => {
    const { fake, repo } = repository();
    fake.raw("custom-id", world() as unknown as JsonValue);
    await repo.listWorlds();
    const seen: RepositoryChange[] = [];
    repo.onChange((change) => seen.push(change));
    fake.docs.delete("custom-id");
    fake.emit({ id: "custom-id", revision: 1, deleted: true });
    await settle();
    expect(seen).toEqual([{ kind: "world", id: "custom-id", deleted: true }]);
  });
});

describe("export and import", () => {
  it("round-trips a plan into another world", async () => {
    const { repo } = repository();
    const main = await repo.ensureWorld();
    const saved = await repo.putPlan(plan(main.id));
    const file = await repo.exportPlan(saved.id);
    expect(file).toEqual({ format: "tavora.satisfactory.plan-file", version: 1, gameBuild: sampleData.game.build, plan: saved.value });

    const second = await repo.putWorld(world("Second save"));
    const imported = await repo.importPlan(JSON.parse(JSON.stringify(file)), second.id);
    expect(imported.id).not.toBe(saved.id);
    expect(imported.value).toEqual({ ...saved.value, worldId: second.id });
    expect(await repo.listPlans()).toHaveLength(2);
  });

  it("refuses to export a plan that is gone", async () => {
    const { repo } = repository();
    await expect(repo.exportPlan("plan-gone")).rejects.toThrow("This plan is gone.");
  });

  const file = (patch: Record<string, unknown> = {}, planPatch: Record<string, unknown> = {}) => ({
    format: "tavora.satisfactory.plan-file",
    version: 1,
    gameBuild: 0,
    plan: { ...plan("world-elsewhere"), ...planPatch },
    ...patch,
  });

  it.each([
    ["no object", "not a plan", "This isn't a Satisfactory plan file."],
    ["another format", file({ format: "tavora.enshrouded" }), "This isn't a Satisfactory plan file."],
    ["a newer version", file({ version: 2 }), "This plan file is from a newer version of the planner. Update it and try again."],
    ["an unknown version", file({ version: "1" }), "This plan file's version isn't supported."],
    ["no plan", file({ plan: null }), "This plan file is damaged."],
    ["an unknown item", file({}, { targets: [{ item: "Desc_Nothing_C", perMinute: 5 }] }), "This plan uses an item the planner doesn't know: Desc_Nothing_C."],
    ["an unknown fixed input", file({}, { fixedInputs: [{ item: "Desc_Nothing_C", perMinute: 5 }] }), "This plan uses an item the planner doesn't know: Desc_Nothing_C."],
    ["an unknown recipe", file({}, { recipeChoices: { Desc_IronScrew_C: "Recipe_Nothing_C" } }), "This plan uses a recipe the planner doesn't know: Recipe_Nothing_C."],
    ["a rate of 0", file({}, { targets: [{ item: "Desc_IronScrew_C", perMinute: 0 }] }), "Rates need to be above 0 and at most 1,000,000 a minute."],
    ["an endless rate", file({}, { targets: [{ item: "Desc_IronScrew_C", perMinute: 1e9 }] }), "Rates need to be above 0 and at most 1,000,000 a minute."],
    ["a rate as text", file({}, { targets: [{ item: "Desc_IronScrew_C", perMinute: "5" }] }), "Rates need to be above 0 and at most 1,000,000 a minute."],
    ["a target twice", file({}, { targets: [{ item: "Desc_IronScrew_C", perMinute: 5 }, { item: "Desc_IronScrew_C", perMinute: 5 }] }), "This plan lists Screws twice in its targets."],
    ["too many targets", file({}, { targets: Array.from({ length: 101 }, () => ({ item: "Desc_IronScrew_C", perMinute: 1 })) }), "A plan can have at most 100 targets."],
    ["no name", file({}, { name: " " }), "Choose a name between 1 and 100 characters."],
  ])("refuses %s", async (_, value, message) => {
    const { repo } = repository();
    const main = await repo.ensureWorld();
    await expect(repo.importPlan(value, main.id)).rejects.toThrow(message);
    expect(await repo.listPlans()).toEqual([]);
  });

  it("imports a plan without targets", async () => {
    const { repo } = repository();
    const main = await repo.ensureWorld();
    expect((await repo.importPlan(file({}, { targets: [] }), main.id)).value.targets).toEqual([]);
  });

  it("refuses to import into a world that is gone", async () => {
    const { repo } = repository();
    await expect(repo.importPlan(file(), "world-gone")).rejects.toThrow("This plan's world is gone. Choose another world.");
  });
});
