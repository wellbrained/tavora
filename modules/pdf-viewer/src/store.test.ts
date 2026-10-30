import { createMemoryHost } from "@tavora/sdk/testing";
import { describe, expect, it } from "vitest";
import { createFilesStore } from "./store";

const open = (sdk: ReturnType<typeof createMemoryHost>["sdk"]) => createFilesStore(sdk, { title: () => "Files", debounceMs: 0 });
const pdf = (name = "Guide.pdf") => new File(["%PDF-1.7"], name, { type: "application/pdf" });
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

describe("adding files", () => {
  it("stores the file and lists it under its own name", async () => {
    const { sdk } = createMemoryHost();
    const store = await open(sdk);
    const entry = await store.add(pdf());
    expect(entry).toMatchObject({ name: "Guide.pdf", type: "application/pdf", kind: "pdf" });
    expect(store.files.value.map((file) => file.id)).toEqual([entry.id]);
    expect((await sdk.blobs.list()).map((blob) => blob.id)).toEqual([entry.id]);
    expect(store.url(entry.id)).toContain(entry.id);
  });

  it("takes a picture from its extension when the system gave no type", async () => {
    const { sdk } = createMemoryHost();
    const store = await open(sdk);
    const entry = await store.add(new File(["x"], "Map.PNG", { type: "" }));
    expect(entry.kind).toBe("image");
  });

  it("refuses other files and files that are too big, storing nothing", async () => {
    const { sdk } = createMemoryHost({ limits: { maxBlobBytes: 10 } });
    const store = await open(sdk);
    await expect(store.add(new File(["x"], "a.docx", { type: "application/msword" }))).rejects.toMatchObject({ kind: "type" });
    await expect(store.add(new File(["x".repeat(11)], "big.pdf", { type: "application/pdf" }))).rejects.toMatchObject({ kind: "size" });
    expect(await sdk.blobs.list()).toEqual([]);
    expect(store.files.value).toEqual([]);
  });

  it("says when the workspace is full", async () => {
    const { sdk } = createMemoryHost({ limits: { maxBlobsBytes: 12 } });
    const store = await open(sdk);
    await store.add(pdf());
    await expect(store.add(pdf("Second.pdf"))).rejects.toMatchObject({ kind: "full" });
  });
});

describe("renaming, remembering and removing", () => {
  it("renames, remembers the view and removes the stored file with its entry", async () => {
    const { sdk } = createMemoryHost();
    const store = await open(sdk);
    const entry = await store.add(pdf());
    await store.rename(entry.id, "Walkthrough");
    store.setView(entry.id, { page: 7, zoom: 1.5, fit: null });
    await store.flush();
    expect(store.find(entry.id)).toMatchObject({ name: "Walkthrough", view: { page: 7, zoom: 1.5, fit: null } });
    await store.remove(entry.id);
    expect(store.files.value).toEqual([]);
    expect(await sdk.blobs.list()).toEqual([]);
  });

  it("shares the list between two panels of one workspace", async () => {
    const a = createMemoryHost();
    const b = createMemoryHost({ share: a.host });
    const first = await open(a.sdk);
    const second = await open(b.sdk);
    const entry = await first.add(pdf());
    await settle();
    expect(second.files.value.map((file) => file.id)).toEqual([entry.id]);
    await second.rename(entry.id, "Shared");
    await settle();
    expect(first.find(entry.id)?.name).toBe("Shared");
  });
});

describe("files linked to their original", () => {
  const REF = "a".repeat(32);
  /** A host with one original on disk that the test can change or delete. */
  function linkedHost() {
    const memory = createMemoryHost();
    const original = { bytes: new TextEncoder().encode("%PDF-1.7 first"), modifiedAt: 1000, there: true };
    const forgotten: string[] = [];
    memory.host.answer("files.check", ({ id }) => (id !== REF || forgotten.includes(id) ? { found: false, reason: "unlinked" } : original.there ? { found: true, size: original.bytes.byteLength, modifiedAt: original.modifiedAt } : { found: false, reason: "gone" }));
    memory.host.answer("files.read", () => original.bytes);
    memory.host.answer("files.forget", ({ id }) => (forgotten.push(id), null));
    return { ...memory, original, forgotten, picked: { id: REF, name: "Rules.pdf", size: original.bytes.byteLength } };
  }

  it("keeps a copy with the version of the original it came from", async () => {
    const { sdk, picked } = linkedHost();
    const store = await open(sdk);
    const entry = await store.addLinked(picked);
    expect(entry).toMatchObject({ name: "Rules.pdf", kind: "pdf", link: { ref: REF, size: 14, modifiedAt: 1000 } });
    expect(await store.check(entry.id)).toBe("same");
  });

  it("reloads a changed original in place, keeping the file's name, place and page under the new copy's id", async () => {
    const { sdk, original, picked } = linkedHost();
    const store = await open(sdk);
    const entry = await store.addLinked(picked);
    store.setView(entry.id, { page: 7 });
    original.bytes = new TextEncoder().encode("%PDF-1.7 second version");
    original.modifiedAt = 2000;
    expect(await store.check(entry.id)).toBe("changed");
    const id = await store.reload(entry.id);
    expect(id).not.toBe(entry.id);
    expect(store.files.value).toHaveLength(1);
    expect(store.find(id)).toMatchObject({ previous: entry.id, name: "Rules.pdf", view: { page: 7 }, link: { size: 23, modifiedAt: 2000 } });
    expect((await sdk.blobs.list()).map((blob) => blob.id)).toEqual([id]);
    expect(await store.check(id)).toBe("same");
  });

  it("asks no more about a version the user skipped, but does about the next one", async () => {
    const { sdk, original, picked } = linkedHost();
    const store = await open(sdk);
    const entry = await store.addLinked(picked);
    original.modifiedAt = 2000;
    await store.skip(entry.id);
    expect(await store.check(entry.id)).toBe("skipped");
    original.modifiedAt = 3000;
    expect(await store.check(entry.id)).toBe("changed");
  });

  it("tells a gone original apart from one this PC has no link for, and can keep the copy alone", async () => {
    const { sdk, original, forgotten, picked } = linkedHost();
    const store = await open(sdk);
    const entry = await store.addLinked(picked);
    original.there = false;
    expect(await store.check(entry.id)).toBe("gone");
    await store.unlink(entry.id);
    expect(store.find(entry.id)?.link).toBeUndefined();
    expect(forgotten).toEqual([REF]);
    expect(await store.check(entry.id)).toBeNull();
  });

  it("drops the link when the file is removed", async () => {
    const { sdk, forgotten, picked } = linkedHost();
    const store = await open(sdk);
    const entry = await store.addLinked(picked);
    await store.remove(entry.id);
    expect(store.files.value).toEqual([]);
    expect(forgotten).toEqual([REF]);
  });

  it("forgets the link of a picked file it could not keep", async () => {
    const { sdk, forgotten, picked } = linkedHost();
    const store = await open(sdk);
    await expect(store.addLinked({ ...picked, name: "notes.docx" })).rejects.toMatchObject({ kind: "type" });
    expect(forgotten).toEqual([REF]);
    expect(store.files.value).toEqual([]);
  });
});
