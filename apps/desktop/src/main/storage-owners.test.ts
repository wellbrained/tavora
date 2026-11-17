import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { DataRegistry } from "./storage";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 1, 2, 3, 4]);
async function* body() {
  yield PNG;
}

const A = "0123456789abcdef0123456789abcdef";
const B = "fedcba9876543210fedcba9876543210";
const MODULE = "local.example.a";

let dir: string;
let registry: DataRegistry;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "tavora-owners-"));
  registry = new DataRegistry(dir, () => path.join(dir, "files"));
});

// Two publishers can use the same module id: one must never see the other's files.
describe("files of two publishers with the same module id", () => {
  it("keeps a workspace's files apart", async () => {
    const info = await registry.get(A, MODULE, "poe2").blobs.put(body());
    const theirs = registry.get(B, MODULE, "poe2").blobs;
    expect(await theirs.list()).toEqual([]);
    expect(await theirs.open(info.id)).toBeNull();
    expect((await registry.get(A, MODULE, "poe2").blobs.open(info.id))?.bytes).toBe(PNG.length);
    // Deleting by A's id from B's side leaves A's file alone.
    await theirs.delete(info.id);
    expect(await registry.get(A, MODULE, "poe2").blobs.list()).toHaveLength(1);
  });

  it("keeps the files shared by every workspace apart", async () => {
    const info = await registry.appBlobs(A, MODULE).put(body());
    const theirs = registry.appBlobs(B, MODULE);
    expect(await theirs.list()).toEqual([]);
    expect(await theirs.open(info.id)).toBeNull();
    expect(await registry.appBlobs(A, MODULE).open(info.id)).not.toBeNull();
  });

  it("keeps documents apart", async () => {
    const stored = await registry.get(A, MODULE, "poe2").documents.put({ type: "note", title: "mine", data: {} });
    const theirs = registry.get(B, MODULE, "poe2").documents;
    expect(await theirs.list()).toEqual([]);
    expect(await theirs.get(stored.id)).toBeNull();
    expect(await registry.get(A, MODULE, "poe2").documents.get(stored.id)).not.toBeNull();
  });
});
