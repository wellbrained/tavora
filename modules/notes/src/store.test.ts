import type { JsonValue } from "@tavora/sdk";
import { createMemoryHost, type MemoryHost, type MemoryHostOptions } from "@tavora/sdk/testing";
import { describe, expect, it, vi } from "vitest";
import { collectImageIds, emptyContent, ORDER_ID, parseNote, SCRATCHPAD_ID, type NoteData, type RichText } from "./notes";
import { createNotesStore, type NoteChange } from "./store";

const TWO_HOURS = 2 * 60 * 60 * 1000;

function textContent(text: string): RichText {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

function noteWith(text: string, patch: Partial<NoteData> = {}): NoteData {
  return { ...parseNote(null), content: textContent(text), text, ...patch };
}

/** Puts a note into the shared documents as another panel (or an earlier run) would. */
function seed(host: MemoryHost, id: string, note: NoteData) {
  return host.documents.put({ id, title: note.text || "Untitled note", data: note as unknown as JsonValue });
}

const stored = (host: MemoryHost, id: string) => host.documents.get(id)?.data as unknown as NoteData | undefined;

/** Two panels of Notes on one workspace. */
function panels(options: MemoryHostOptions = {}) {
  const a = createMemoryHost(options);
  const b = createMemoryHost({ ...options, share: a.host });
  return { a, b };
}

const open = (sdk: ReturnType<typeof createMemoryHost>["sdk"]) => createNotesStore(sdk, { debounceMs: 0 });

describe("removeUnusedImages", () => {
  /** A host whose clock is old, so the pictures it stores are old enough to be cleared. */
  function oldHost() {
    return createMemoryHost({ now: () => Date.now() - TWO_HOURS });
  }
  const picture = async (sdk: ReturnType<typeof oldHost>["sdk"]) => (await sdk.blobs.put(new Blob(["x"], { type: "image/png" }))).id;

  it("deletes an old picture that no note uses and keeps the ones in use", async () => {
    const { sdk, host } = oldHost();
    const used = await picture(sdk);
    const unused = await picture(sdk);
    seed(host, "a", noteWith("one", { images: [used] }));
    const store = await open(sdk);
    await store.load();
    await store.removeUnusedImages();
    expect((await sdk.blobs.list()).map((blob) => blob.id)).toEqual([used]);
    expect(unused).not.toBe(used);
  });

  it("deletes nothing when a note changed after this panel loaded", async () => {
    const { a, b } = panels({ now: () => Date.now() - TWO_HOURS });
    const first = await picture(a.sdk);
    const second = await picture(a.sdk);
    seed(a.host, "a", noteWith("one", { images: [first] }));
    const store = await open(a.sdk);
    await store.load();
    // Another panel saved the note and moved its picture to the second one; this panel has not read that yet.
    const before = a.host.documents.get("a")!;
    a.host.answer("documents.get", async () => before);
    await b.sdk.documents.put({ id: "a", title: "one", data: noteWith("one", { images: [second] }) as unknown as JsonValue, ifRevision: 1 });
    await store.removeUnusedImages();
    expect(await a.sdk.blobs.list()).toHaveLength(2);
  });

  it("deletes nothing when another panel added a note this one has not read", async () => {
    const { a } = panels({ now: () => Date.now() - TWO_HOURS });
    const only = await picture(a.sdk);
    seed(a.host, "a", noteWith("one"));
    const store = await open(a.sdk);
    await store.load();
    seed(a.host, "b", noteWith("two", { images: [only] }));
    await store.removeUnusedImages();
    expect(await a.sdk.blobs.list()).toHaveLength(1);
  });

  it("collects the pictures of a note", () => {
    expect(collectImageIds(emptyContent())).toEqual([]);
  });
});

describe("the notes list and the open note", () => {
  it("lists the notes with a light copy of each, and the scratchpad but not the order", async () => {
    const { a } = panels();
    seed(a.host, "a", noteWith("First\nsecond line", { pinned: true }));
    seed(a.host, SCRATCHPAD_ID, noteWith("jotted"));
    seed(a.host, ORDER_ID, { ids: ["a"] } as unknown as NoteData);
    const store = await open(a.sdk);
    await store.load();
    expect([...store.entries.value.keys()].sort()).toEqual(["a", SCRATCHPAD_ID]);
    expect(store.entries.value.get("a")).toMatchObject({ title: "First", pinned: true, text: "First\nsecond line" });
    expect(store.order.value).toEqual(["a"]);
    expect(store.selectedId.value).toBe(SCRATCHPAD_ID);
    expect(store.current.value?.data.text).toBe("jotted");
  });

  it("creates a note, shows it, renames it and deletes it with Undo", async () => {
    const { a } = panels();
    const store = await open(a.sdk);
    const id = await store.create();
    expect(store.selectedId.value).toBe(id);
    expect(store.entries.value.get(id)?.title).toBe("Untitled note");

    store.current.value!.update((draft) => void ((draft.content = textContent("Atlas plan")), (draft.text = "Atlas plan")));
    await store.current.value!.flush();
    expect(store.entries.value.get(id)?.title).toBe("Atlas plan");
    expect(stored(a.host, id)?.text).toBe("Atlas plan");

    await store.rename(id, "  Plans  ");
    expect(store.entries.value.get(id)?.title).toBe("Plans");
    expect(stored(a.host, id)?.title).toBe("Plans");

    const undo = await store.remove(id);
    expect(a.host.documents.get(id)).toBeNull();
    expect(store.entries.value.has(id)).toBe(false);
    // The panel goes back to the scratchpad.
    expect(store.selectedId.value).toBe(SCRATCHPAD_ID);

    await undo();
    expect(stored(a.host, id)?.text).toBe("Atlas plan");
    expect(store.entries.value.get(id)?.title).toBe("Plans");
    await store.select(id);
    expect(store.selectedId.value).toBe(id);
  });

  it("pins and renames a note that is not the open one", async () => {
    const { a } = panels();
    seed(a.host, "a", noteWith("First"));
    const store = await open(a.sdk);
    await store.load();
    await store.setPinned("a", true);
    expect(stored(a.host, "a")?.pinned).toBe(true);
    expect(store.entries.value.get("a")?.pinned).toBe(true);
    await store.rename("a", "Mine");
    expect(store.entries.value.get("a")).toMatchObject({ title: "Mine", fixedTitle: "Mine" });
  });

  it("saves the scratchpad on its own and keeps it out of the notes' choice", async () => {
    const { a } = panels();
    const store = await open(a.sdk);
    store.scratchpad.update((draft) => void ((draft.text = "quick"), (draft.content = textContent("quick"))));
    await store.scratchpad.flush();
    expect(a.host.documents.get(SCRATCHPAD_ID)?.title).toBe("Scratchpad");
    // Making a note and deleting it comes back to the scratchpad, never to the order or to a stray document.
    seed(a.host, ORDER_ID, { ids: [] } as unknown as NoteData);
    const id = await store.create();
    await store.remove(id);
    expect(store.selectedId.value).toBe(SCRATCHPAD_ID);
    expect(store.current.value).toBe(store.scratchpad);
  });

  it("refuses to show the order document as a note", async () => {
    const { a } = panels();
    seed(a.host, ORDER_ID, { ids: [] } as unknown as NoteData);
    const store = await open(a.sdk);
    await expect(store.select(ORDER_ID)).rejects.toThrow();
    expect(store.selectedId.value).toBe(SCRATCHPAD_ID);
  });
});

describe("restoring and navigating", () => {
  it("opens the note the panel showed before a restart", async () => {
    const { a } = panels();
    seed(a.host, "a", noteWith("First"));
    seed(a.host, "b", noteWith("Second"));
    const again = createMemoryHost({ share: a.host, launch: { reason: "restore", content: { id: "b", title: "Second" } } });
    const store = await open(again.sdk);
    expect(store.selectedId.value).toBe("b");
    expect(store.current.value?.data.text).toBe("Second");
  });

  it("falls back to the state older versions saved, and to the scratchpad when that note is gone", async () => {
    const { a } = panels();
    seed(a.host, "a", noteWith("First"));
    const older = createMemoryHost({ share: a.host, launch: { reason: "restore", content: null } });
    await older.sdk.panel.setState({ selected: "a" });
    expect((await open(older.sdk)).selectedId.value).toBe("a");

    const gone = createMemoryHost({ share: a.host, launch: { reason: "restore", content: null } });
    await gone.sdk.panel.setState({ selected: "removed" });
    expect((await open(gone.sdk)).selectedId.value).toBe(SCRATCHPAD_ID);
  });

  it("shows a note another panel asks for with panels.open, and publishes the shown note", async () => {
    const { a } = panels();
    seed(a.host, "a", noteWith("First"));
    const store = await open(a.sdk);
    const flushed = vi.fn();
    store.onBeforeSwitch(flushed);
    expect(await a.host.navigate({ id: "a", title: "First" })).toEqual({ handled: true, ok: true });
    expect(flushed).toHaveBeenCalled();
    expect(store.selectedId.value).toBe("a");
    expect(a.host.content).toMatchObject({ id: "a" });
    expect(await a.host.navigate({ id: "nope", title: "Nope" })).toEqual({ handled: true, ok: false });
    expect(store.selectedId.value).toBe("a");
  });
});

describe("two panels", () => {
  it("shows another panel's change to the open note, and its new notes", async () => {
    const { a, b } = panels();
    const first = await open(a.sdk);
    const second = await open(b.sdk);
    const id = await first.create();
    await vi.waitFor(() => expect(second.entries.value.has(id)).toBe(true));
    await second.select(id);

    const heard: NoteChange[] = [];
    second.onChange((change) => heard.push(change));
    first.current.value!.update((draft) => void ((draft.text = "typed in the first"), (draft.content = textContent("typed in the first"))));
    await first.current.value!.flush();
    await vi.waitFor(() => expect(second.current.value?.data.text).toBe("typed in the first"));
    expect(heard.some((change) => change.id === id && change.source === "remote" && !change.deleted)).toBe(true);
    await vi.waitFor(() => expect(second.entries.value.get(id)?.title).toBe("typed in the first"));
  });

  it("keeps this panel's unsaved typing when another panel saves first (the editor owns the note)", async () => {
    const { a, b } = panels();
    const first = await createNotesStore(a.sdk, { debounceMs: 60_000 });
    const second = await open(b.sdk);
    const id = await first.create();
    await vi.waitFor(() => expect(second.entries.value.has(id)).toBe(true));
    await second.select(id);

    first.current.value!.update((draft) => void (draft.text = "mine"));
    expect(first.current.value!.status).toBe("dirty");
    second.current.value!.update((draft) => void (draft.text = "theirs"));
    await second.current.value!.flush();
    await vi.waitFor(() => expect(first.entries.value.get(id)?.revision).toBeGreaterThan(1));
    expect(first.current.value!.data.text).toBe("mine");
    await first.current.value!.flush();
    expect(stored(a.host, id)?.text).toBe("mine");
  });

  it("keeps a note open when another panel deletes it, and brings it back on request", async () => {
    const { a, b } = panels();
    const first = await open(a.sdk);
    const second = await open(b.sdk);
    const id = await first.create();
    first.current.value!.update((draft) => void ((draft.text = "important"), (draft.content = textContent("important"))));
    await first.current.value!.flush();
    await vi.waitFor(() => expect(second.entries.value.has(id)).toBe(true));

    const heard: NoteChange[] = [];
    first.onChange((change) => heard.push(change));
    b.host.documents.delete(id);
    await vi.waitFor(() => expect(first.deleted.value).toBe(true));
    expect(first.selectedId.value).toBe(id);
    expect(heard.some((change) => change.deleted)).toBe(true);
    await vi.waitFor(() => expect(first.entries.value.has(id)).toBe(false));
    expect(a.host.documents.get(id)).toBeNull();

    await first.restoreDeleted();
    expect(first.deleted.value).toBe(false);
    expect(stored(a.host, id)?.text).toBe("important");
    expect(first.entries.value.get(id)?.title).toBe("important");
    expect(first.selectedId.value).toBe(id);
  });

  it("follows the order the other panel set", async () => {
    const { a, b } = panels();
    const first = await open(a.sdk);
    const second = await open(b.sdk);
    await first.setOrder(["x", "y"]);
    await vi.waitFor(() => expect(second.order.value).toEqual(["x", "y"]));
  });
});
