import type { JsonValue } from "@tavora/sdk";
import { openDocument } from "@tavora/sdk/store";
import { createMemoryHost } from "@tavora/sdk/testing";
import { expect, it } from "vitest";
import { contentFromText, isBlank, leftEmpty, restoreCleared, type NoteData } from "./notes";

// A note made with New note and left empty goes when you leave it; one with only a title or only a picture stays.
it("counts a new note as empty only when it has no text, no title of its own and no picture", () => {
  const entry = { text: "  ", fixedTitle: "", images: [] as string[] };
  expect(leftEmpty(entry)).toBe(true);
  expect(leftEmpty({ ...entry, fixedTitle: "Shopping" })).toBe(false);
  expect(leftEmpty({ ...entry, images: ["0123456789abcdef0123456789abcdef"] })).toBe(false);
  expect(leftEmpty({ ...entry, text: "milk" })).toBe(false);
});

// Undo of Clear scratchpad puts the old text back only while nothing new was written there.
it("counts a note as blank only with no text and no picture", () => {
  expect(isBlank({ text: " \n", images: [] })).toBe(true);
  expect(isBlank({ text: "new line", images: [] })).toBe(false);
  expect(isBlank({ text: "", images: ["0123456789abcdef0123456789abcdef"] })).toBe(false);
});

it("puts cleared text back only into a blank note, also when another panel wrote there first", async () => {
  const { sdk, host } = createMemoryHost();
  const other = createMemoryHost({ share: host });
  const blank = { content: contentFromText(""), images: [], text: "" };
  host.documents.put({ id: "pad", title: "Pad", data: blank as unknown as JsonValue });
  const note = await openDocument<NoteData>(sdk, "pad", { parse: (raw) => (raw ?? blank) as unknown as NoteData, title: () => "Pad", debounceMs: 0 });
  const old = { content: contentFromText("old"), text: "old" };
  // Another panel writes a line just before; this panel's copy is still blank, so the change runs again on theirs.
  await other.sdk.documents.put({ id: "pad", title: "Pad", data: { ...blank, text: "new", content: contentFromText("new") } as unknown as JsonValue });
  expect(await restoreCleared(note, old)).toBe(false);
  expect((host.documents.get("pad")!.data as { text: string }).text).toBe("new");
  // The check is made on the copy the change runs on (after a conflict, the newer one), not on what the panel showed before.
  const newer = { ...blank, text: "new" } as unknown as NoteData;
  expect(await restoreCleared({ update: (change) => change(newer), flush: async () => undefined }, old)).toBe(false);
  expect(newer.text).toBe("new");
  expect(await restoreCleared({ update: (change) => change({ ...blank } as unknown as NoteData), flush: async () => undefined }, old)).toBe(true);
  await note.dispose();
});
