import { mkdir, mkdtemp, readdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentStore } from "./documents";

let dir: string;

beforeEach(async () => {
  dir = path.join(await mkdtemp(path.join(tmpdir(), "tavora-docs-")), "documents");
});

describe("DocumentStore", () => {
  it("creates documents with generated ids and lists newest first", async () => {
    const store = new DocumentStore(dir);
    const a = await store.put({ title: "A", data: { n: 1 } });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const b = await store.put({ id: "build-b", title: "B", data: [1, 2, 3] });

    expect(a.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(b).toMatchObject({ id: "build-b", title: "B", revision: 1, bytes: 7 });
    expect((await store.list()).map((doc) => doc.id)).toEqual(["build-b", a.id]);
    expect(await new DocumentStore(dir).get("build-b")).toMatchObject({ title: "B", data: [1, 2, 3], revision: 1 });
    expect(await store.get("missing")).toBeNull();
  });

  it("refuses ids Windows or the store keep for themselves, in any case, for new documents", async () => {
    const store = new DocumentStore(dir);
    for (const id of ["index", "Index", "CON", "con", "prn", "Aux", "nul", "com0", "com1", "COM9", "lpt1", "Lpt9"]) {
      await expect(store.put({ id, title: "X", data: 1 })).rejects.toMatchObject({ code: "INVALID_PARAMS" });
    }
    // Only the exact names: these are ordinary ids.
    for (const id of ["indexes", "console", "com10", "nul-1", "my-index", "conin"]) {
      expect(await store.put({ id, title: "X", data: 1 })).toMatchObject({ id, revision: 1 });
    }
    expect(await store.get("index")).toBeNull();
    await store.delete("index");
    expect((await store.list()).length).toBe(6);
  });

  it("refuses a new id that differs from a saved one only by case", async () => {
    const store = new DocumentStore(dir);
    await store.put({ id: "Notes", title: "Notes", data: 1 });
    await expect(store.put({ id: "notes", title: "Other", data: 2 })).rejects.toMatchObject({ code: "INVALID_PARAMS" });
    await expect(store.put({ id: "NOTES", title: "Other", data: 2 })).rejects.toMatchObject({ code: "INVALID_PARAMS" });
    expect(await store.put({ id: "Notes", title: "Notes", data: 3 })).toMatchObject({ revision: 2 });
    expect(await new DocumentStore(dir).get("Notes")).toMatchObject({ data: 3 });
  });

  it("keeps documents saved before the rule readable and writable, and drops an index entry for the index itself", async () => {
    await mkdir(dir, { recursive: true });
    const stamp = "2026-01-01T00:00:00.000Z";
    const summary = (id: string) => ({ id, title: id, revision: 1, updatedAt: stamp, bytes: 1 });
    const saved = (id: string, data: number) => JSON.stringify({ version: 1, id, title: id, revision: 1, updatedAt: stamp, data });
    // A system that tells case apart could hold both of a pair, and a device name.
    const ids = process.platform === "win32" ? ["Plan"] : ["Plan", "plan", "con"];
    for (const [n, id] of ids.entries()) await writeFile(path.join(dir, `${id}.json`), saved(id, n));
    const index = path.join(dir, "index.json");
    await writeFile(index, JSON.stringify({ version: 1, documents: Object.fromEntries([...ids, "index"].map((id) => [id, summary(id)])) }));
    const later = new Date(Date.now() + 60_000);
    await utimes(index, later, later);
    const store = new DocumentStore(dir);
    expect((await store.list()).map((doc) => doc.id).sort()).toEqual([...ids].sort());
    for (const [n, id] of ids.entries()) {
      expect(await store.get(id)).toMatchObject({ id, data: n });
      expect(await store.put({ id, title: id, data: 9 })).toMatchObject({ revision: 2 });
    }
    expect(await store.get("index")).toBeNull();
  });

  it("uses revisions for optimistic concurrency; ifRevision 0 means create only", async () => {
    const store = new DocumentStore(dir);
    await store.put({ id: "plan", title: "Plan", data: 1, ifRevision: 0 });
    await expect(store.put({ id: "plan", title: "Plan", data: 2, ifRevision: 0 })).rejects.toMatchObject({
      code: "CONFLICT",
      extra: { revision: 1 },
    });
    expect(await store.put({ id: "plan", title: "Plan", data: 2, ifRevision: 1 })).toMatchObject({ revision: 2 });
    await expect(store.delete("plan", 1)).rejects.toMatchObject({ code: "CONFLICT" });
    await store.delete("plan", 2);
    expect(await store.list()).toEqual([]);
  });

  it("enforces size, count and total quotas", async () => {
    const store = new DocumentStore(dir, { maxDocumentBytes: 20, maxDocumentsBytes: 30, maxDocuments: 2 });
    await expect(store.put({ title: "big", data: "x".repeat(30) })).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
    await store.put({ id: "a", title: "a", data: "x".repeat(10) });
    await expect(store.put({ id: "b", title: "b", data: "x".repeat(18) })).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
    await store.put({ id: "b", title: "b", data: "x" });
    await expect(store.put({ id: "c", title: "c", data: 1 })).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
    // Replacing a document counts its old size only once.
    await store.put({ id: "a", title: "a", data: "y".repeat(15) });
  });

  it("keeps what was saved when a save is too big", async () => {
    const store = new DocumentStore(dir, { maxDocumentBytes: 20, maxDocumentsBytes: 1000, maxDocuments: 10 });
    await store.put({ id: "note", title: "note", data: "kept" });
    await expect(store.put({ id: "note", title: "note", data: "x".repeat(30) })).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
    expect(await store.get("note")).toMatchObject({ revision: 1, data: "kept" });
    expect(await new DocumentStore(dir).get("note")).toMatchObject({ revision: 1, data: "kept" });
  });

  it.each([
    [{ id: "../escape", title: "x", data: 1 }],
    [{ id: "", title: "x", data: 1 }],
    [{ id: "a/b", title: "x", data: 1 }],
    [{ id: "x".repeat(65), title: "x", data: 1 }],
    [{ title: 5, data: 1 }],
    [{ title: "x".repeat(201), data: 1 }],
    [{ title: "x" }],
    [{ title: "x", data: new Date() }],
    [{ title: "x", data: 1, ifRevision: "1" }],
    [null],
  ])("rejects %j", async (params) => {
    const store = new DocumentStore(dir);
    await expect(store.put(params)).rejects.toMatchObject({ code: "INVALID_PARAMS" });
  });

  it("emits changes with their origin", async () => {
    const store = new DocumentStore(dir);
    const listener = vi.fn();
    store.on("change", listener);
    const origin = {};
    await store.put({ id: "a", title: "a", data: 1 }, origin);
    await store.delete("a", undefined, origin);
    await store.delete("a");
    expect(listener.mock.calls).toEqual([
      [{ id: "a", revision: 1, deleted: false }, origin],
      [{ id: "a", revision: 1, deleted: true }, origin],
    ]);
  });

  it("rebuilds a stale or missing index from the document files", async () => {
    const store = new DocumentStore(dir);
    await store.put({ id: "a", title: "A", data: 1 });
    // Simulate a crash after a document write but before the index write.
    await writeFile(
      path.join(dir, "b.json"),
      JSON.stringify({ version: 1, id: "b", title: "B", revision: 3, updatedAt: "2030-01-01T00:00:00.000Z", data: 2 }),
    );
    const future = new Date(Date.now() + 10_000);
    await utimes(path.join(dir, "b.json"), future, future);
    expect((await new DocumentStore(dir).list()).map((doc) => [doc.id, doc.revision])).toEqual([
      ["b", 3],
      ["a", 1],
    ]);

    await writeFile(path.join(dir, "index.json"), "{broken");
    expect(await new DocumentStore(dir).list()).toHaveLength(2);
    expect((await readdir(dir)).some((name) => name.startsWith("index.json.corrupt-"))).toBe(true);
  });
});
