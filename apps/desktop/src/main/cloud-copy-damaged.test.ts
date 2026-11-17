import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CloudCopy, CopyError, EMPTY_STATE, type CopyStorage, type SwapAnswer } from "./cloud-copy";
import { cleanUp, pc } from "./cloud-copy.test-helper";
import { copyKeys, newCopyKey, seal } from "./copy-crypto";

afterEach(cleanUp);

/** A copy kept in memory, so a test can change what comes back. */
class MemoryStorage implements CopyStorage {
  limit = null;
  arrivesLate = false;
  parts = new Map<string, Uint8Array>();
  current: { version: number; sealed: Uint8Array } | null = null;
  async remote() {
    return this.current ? { version: this.current.version, size: 0, updatedAt: "" } : null;
  }
  async manifest() {
    return this.current;
  }
  async putParts(parts: { id: Buffer; data: Buffer }[]) {
    for (const part of parts) this.parts.set(part.id.toString("hex"), part.data);
  }
  async getParts(ids: string[]) {
    return ids.flatMap((id) => (this.parts.has(id) ? [{ id, data: this.parts.get(id)! }] : []));
  }
  nextVersion(base: number) {
    return base + 1;
  }
  async swap(_base: number, version: number | null, _ids: string[], sealed: Uint8Array): Promise<SwapAnswer> {
    this.current = { version: version!, sealed };
    return { status: "saved", version: version!, size: 0 };
  }
  async remove() {
    this.current = null;
  }
}

type Entry = { path: string; size: number; sha256: string; parts: string[] };

/** A good copy of two files, and a way to put any list in its place, sealed with the right key. */
async function setup() {
  const key = newCopyKey();
  const storage = new MemoryStorage();
  const a = await pc({ "library.json": "first file", "profile.json": "second file" });
  const uploaded = await new CloudCopy(storage).upload(key, a.roots, EMPTY_STATE);
  if (uploaded.status !== "uploaded") throw new Error(uploaded.status);
  const good = Object.entries(uploaded.state.files).map(([name, file]): Entry => ({ path: name, size: file.size, sha256: file.sha256, parts: file.parts }));
  const publish = (files: Entry[]) => {
    storage.current = { version: 1, sealed: seal(copyKeys(key), Buffer.from(JSON.stringify({ v: 1, version: 1, pictures: true, files }))) };
  };
  // The receiving PC with data of its own.
  const b = await pc({ "library.json": "mine", "module-data/m/note.json": "mine too" });
  const staging = path.join(b.root, "staging");
  const download = () => new CloudCopy(storage).download(key, b.roots, staging);
  const live = async () => ({ library: await readFile(path.join(b.userData, "library.json"), "utf8"), note: await readFile(path.join(b.userData, "module-data", "m", "note.json"), "utf8"), data: await readdir(b.userData) });
  return { key, storage, good, publish, b, download, live, staging };
}

describe("a damaged copy", () => {
  it("comes down when nothing was changed", async () => {
    const { good, publish, download } = await setup();
    publish(good);
    expect(await download()).toMatchObject({ version: 1 });
  });

  it("is refused when a part was swapped for another part of the same copy", async () => {
    const { good, publish, storage, download, live, b } = await setup();
    const before = await live();
    publish(good);
    // Sealed with the right key, but it is not the part its name says.
    const [first, second] = [good[0]!.parts[0]!, good[1]!.parts[0]!];
    storage.parts.set(first, storage.parts.get(second)!);
    // The file checks would catch it too, so the part's own check is told by its message.
    await expect(download()).rejects.toMatchObject({ reason: "damaged", message: "a part is not what its name says" });
    expect(await live()).toEqual(before);
    expect(await readdir(b.root)).not.toContain("kept");
  });

  it("is refused when a file is not the size its list says", async () => {
    const { good, publish, download, live } = await setup();
    const before = await live();
    publish([{ ...good[0]!, size: good[0]!.size + 1 }, good[1]!]);
    await expect(download()).rejects.toMatchObject({ reason: "damaged" });
    expect(await live()).toEqual(before);
  });

  it("is refused when a file does not match its sha256", async () => {
    const { good, publish, download, live } = await setup();
    const before = await live();
    publish([good[0]!, { ...good[1]!, sha256: "0".repeat(64) }]);
    const error = await download().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CopyError);
    expect(error).toMatchObject({ reason: "damaged" });
    expect(await live()).toEqual(before);
  });

  it("is refused when a file's list entry has a path that leaves the copy", async () => {
    const { good, publish, download, live, b } = await setup();
    const before = await live();
    for (const bad of ["../escaped.json", "module-data/../../escaped.json", "/escaped.json", "C:/escaped.json", "C:\\escaped.json", "module-data\\..\\x.json"]) {
      publish([good[0]!, { ...good[1]!, path: bad }]);
      await expect(download(), bad).rejects.toMatchObject({ reason: "damaged" });
      expect(await live()).toEqual(before);
    }
    // Nothing was written next to the staging folder or the data folder either.
    expect((await readdir(b.root)).sort()).toEqual(["data"]);
    expect(await readdir(b.userData)).toEqual(before.data);
  });

  it("is refused before anything is written when only one of two files is bad", async () => {
    const { good, publish, download, b } = await setup();
    publish([good[0]!, { ...good[1]!, path: "../escaped.json" }]);
    await expect(download()).rejects.toMatchObject({ reason: "damaged" });
    // The list is checked first: the staging folder was never made.
    expect(await readdir(b.root)).not.toContain("staging");
  });
});
