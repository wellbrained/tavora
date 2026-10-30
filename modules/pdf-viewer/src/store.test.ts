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
