import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { HostError } from "./errors";
import { DataRegistry, isJsonValue, ModuleStore, PanelStateStore } from "./storage";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "tavora-storage-"));
});

describe("ModuleStore", () => {
  it("persists values across store instances", async () => {
    const file = path.join(dir, "storage.json");
    const store = new ModuleStore(file);
    await store.set("count", 3);
    await store.set("plan", { steps: ["a", "b"], done: false });
    await store.delete("missing");

    const reopened = new ModuleStore(file);
    expect(await reopened.get("count")).toBe(3);
    expect(await reopened.get("plan")).toEqual({ steps: ["a", "b"], done: false });
    expect(await reopened.get("nothing")).toBeNull();

    await reopened.delete("count");
    expect(await new ModuleStore(file).get("count")).toBeNull();
  });

  it("enforces the quota on serialized size, counting replaced values once", async () => {
    const store = new ModuleStore(path.join(dir, "storage.json"), 100);
    await store.set("a", "x".repeat(80));
    await store.set("a", "y".repeat(80));
    await expect(store.set("b", "z".repeat(30))).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
    await store.delete("a");
    await store.set("b", "z".repeat(30));
    expect(await store.get("b")).toBe("z".repeat(30));
  });

  it("rejects bad keys and non-JSON values", async () => {
    const store = new ModuleStore(path.join(dir, "storage.json"));
    expect(() => store.set("", 1)).toThrow(HostError);
    expect(() => store.set("k".repeat(257), 1)).toThrow(HostError);
    expect(() => store.get(42)).toThrow(HostError);
    for (const value of [undefined, new Date(), new Map(), NaN, Infinity, () => 1, 1n, new Uint8Array(1)]) {
      expect(() => store.set("k", value)).toThrow(HostError);
    }
  });

  it("treats __proto__ as an ordinary key", async () => {
    const file = path.join(dir, "storage.json");
    const store = new ModuleStore(file);
    await store.set("__proto__", { polluted: true });
    expect(await new ModuleStore(file).get("__proto__")).toEqual({ polluted: true });
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("serializes concurrent writes", async () => {
    const file = path.join(dir, "storage.json");
    const store = new ModuleStore(file);
    await Promise.all(Array.from({ length: 50 }, (_, i) => store.set(`k${i}`, i)));
    const saved = JSON.parse(await readFile(file, "utf8")) as { entries: Record<string, number> };
    expect(Object.keys(saved.entries)).toHaveLength(50);
  });

  it("sets an unreadable file aside instead of overwriting it", async () => {
    const file = path.join(dir, "storage.json");
    await writeFile(file, "{not json");
    const store = new ModuleStore(file);
    expect(await store.get("anything")).toBeNull();
    await store.set("fresh", true);
    const files = await readdir(dir);
    expect(files.some((name) => name.startsWith("storage.json.corrupt-"))).toBe(true);
  });
});

describe("ModuleStore.keys", () => {
  it("lists keys in order", async () => {
    const store = new ModuleStore(path.join(dir, "storage.json"));
    await store.set("b", 1);
    await store.set("a", 2);
    expect(await store.keys()).toEqual(["a", "b"]);
  });
});

describe("PanelStateStore", () => {
  const A = "123e4567-e89b-42d3-a456-426614174000";
  const B = "123e4567-e89b-42d3-a456-426614174001";

  it("stores, clears and prunes per-panel state", async () => {
    const store = new PanelStateStore(path.join(dir, "panel-state"));
    await store.set(A, { tab: 1 });
    await store.set(B, { tab: 2 });
    expect(await new PanelStateStore(path.join(dir, "panel-state")).get(A)).toEqual({ tab: 1 });

    await store.set(A, null);
    expect(await store.get(A)).toBeNull();

    await store.set(A, { tab: 3 });
    await store.prune(new Set([B]));
    expect(await store.get(A)).toBeNull();
    expect(await store.get(B)).toEqual({ tab: 2 });
  });

  it("limits size and rejects ids that are not panel ids", async () => {
    const store = new PanelStateStore(path.join(dir, "panel-state"));
    expect(() => store.set(A, "x".repeat(300 * 1024))).toThrow(HostError);
    expect(() => store.get("../../etc/passwd")).toThrow();
  });
});

describe("isJsonValue", () => {
  it("rejects structures nested deeper than the limit", () => {
    let deep: unknown = 1;
    for (let i = 0; i < 100; i++) deep = [deep];
    expect(isJsonValue(deep)).toBe(false);
    expect(isJsonValue({ a: [1, "b", null, { c: true }] })).toBe(true);
    expect(isJsonValue(Object.create(null))).toBe(true);
  });
});

describe("DataRegistry", () => {
  it("keeps modules and games apart on disk", async () => {
    const registry = new DataRegistry(dir);
    await registry.get("local", "local.example.a", "poe2").settings.set("count", 1);
    await registry.get("local", "local.example.b", "poe2").settings.set("count", 2);
    await registry.get("local", "local.example.a", "satisfactory").settings.set("count", 3);
    await registry.get("local", "local.example.a", "poe2").documents.put({ id: "d", title: "d", data: 1 });

    expect(await registry.get("local", "local.example.a", "poe2").settings.get("count")).toBe(1);
    expect(await registry.get("local", "local.example.b", "poe2").settings.get("count")).toBe(2);
    expect(await registry.get("local", "local.example.a", "satisfactory").settings.get("count")).toBe(3);
    expect(await registry.get("local", "local.example.b", "poe2").documents.list()).toEqual([]);
    expect(registry.get("local", "local.example.a", "poe2")).toBe(registry.get("local", "local.example.a", "poe2"));
  });

  it("refuses ids that could form a path", async () => {
    const registry = new DataRegistry(dir);
    await mkdir(path.join(dir, "module-data"), { recursive: true });
    expect(() => registry.get("local", "../../etc", "poe2")).toThrow();
    expect(() => registry.get("local", "local.example.a", "../x")).toThrow();
    expect(() => registry.get("..", "local.example.a", "poe2")).toThrow();
  });

  it("keeps the same id of different owners apart (S5)", async () => {
    const registry = new DataRegistry(dir);
    const other = "0123456789abcdef0123456789abcdef";
    await registry.get("local", "local.example.a", "poe2").settings.set("secret", 1);
    expect(await registry.get(other, "local.example.a", "poe2").settings.get("secret")).toBeNull();
  });
});
