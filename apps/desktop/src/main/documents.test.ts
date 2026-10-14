import { mkdtemp, readdir, utimes, writeFile } from "node:fs/promises";
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
