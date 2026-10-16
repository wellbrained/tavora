import { describe, expect, it, vi } from "vitest";
import type { TavoraSDK } from "@tavora/sdk";
import { createNotesStore } from "./store";

// The shared UI package also holds .vue components, which these tests do not need.
vi.mock("@tavora/official-ui", () => ({
  serial: () => (run: () => Promise<unknown>) => run(),
  readDocument: async () => ({ data: [] }),
  updateDocument: async () => ({}),
}));

const OLD = "2020-01-01T00:00:00.000Z";
const id = (digit: string) => digit.repeat(32);

/** A stand-in for the SDK with the notes and pictures the test gives it. */
function fakeSdk(notes: Record<string, { revision: number; images: string[] }>, pictures: string[]) {
  const deleted: string[] = [];
  const sdk = {
    documents: {
      list: async () => Object.entries(notes).map(([noteId, note]) => ({ id: noteId, title: noteId, updatedAt: OLD, revision: note.revision })),
      get: async (noteId: string) => {
        const note = notes[noteId];
        return note ? { id: noteId, title: noteId, updatedAt: OLD, revision: note.revision, data: { text: "", images: note.images } } : null;
      },
    },
    blobs: {
      list: async () => pictures.map((picture) => ({ id: picture, bytes: 1, type: "image/png", createdAt: OLD })),
      delete: async (picture: string) => void deleted.push(picture),
    },
  } as unknown as TavoraSDK;
  return { sdk, deleted };
}

describe("removeUnusedImages", () => {
  it("deletes an old picture that no note uses and keeps the ones in use", async () => {
    const { sdk, deleted } = fakeSdk({ a: { revision: 1, images: [id("a")] } }, [id("a"), id("b")]);
    const store = createNotesStore(sdk);
    await store.load();
    await store.removeUnusedImages();
    expect(deleted).toEqual([id("b")]);
  });

  it("deletes nothing when a note changed after this panel loaded", async () => {
    const notes = { a: { revision: 1, images: [id("a")] } };
    const { sdk, deleted } = fakeSdk(notes, [id("a"), id("b")]);
    const store = createNotesStore(sdk);
    await store.load();
    // Another panel saved the note and moved its picture to b.
    notes.a = { revision: 2, images: [id("b")] };
    await store.removeUnusedImages();
    expect(deleted).toEqual([]);
  });

  it("deletes nothing when another panel added a note this one has not read", async () => {
    const notes: Record<string, { revision: number; images: string[] }> = { a: { revision: 1, images: [] } };
    const { sdk, deleted } = fakeSdk(notes, [id("c")]);
    const store = createNotesStore(sdk);
    await store.load();
    notes.b = { revision: 1, images: [id("c")] };
    await store.removeUnusedImages();
    expect(deleted).toEqual([]);
  });
});
