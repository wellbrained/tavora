// A newer copy may add fields (the catalogue's, before a fallback to the shipped one): this version keeps them through
// a read, an edit and the save, so nothing the newer one wrote is lost when it comes back.
import type { JsonValue } from "@tavora/sdk";
import { expect, it } from "vitest";
import { parseAppearance, parseNote } from "./notes";

it("keeps a newer version's fields on a note", () => {
  const note = parseNote({ version: 1, text: "Hi", title: "", color: "teal", pinned: "yes" } as JsonValue);
  note.text = "Hi there";
  expect(JSON.parse(JSON.stringify(note))).toMatchObject({ text: "Hi there", color: "teal", pinned: false });
});

it("keeps a newer version's fields in the appearance", () => {
  const appearance = parseAppearance({ notes: { font: "nope", lineHeight: 2 }, sidebar: "left" } as JsonValue);
  expect(JSON.parse(JSON.stringify(appearance))).toMatchObject({ notes: { lineHeight: 2 }, sidebar: "left" });
  // A font a newer version added stays too, so the next change of the size here doesn't put the default over it.
  expect(appearance.notes.font).toBe("nope");
});

it("keeps a newer version's fields in the order of the notes", async () => {
  const { parseOrderDoc } = await import("./notes");
  const order = parseOrderDoc({ ids: ["a", 3, "b"], folders: ["x"] } as JsonValue);
  order.ids = ["b", "a"];
  expect(JSON.parse(JSON.stringify(order))).toEqual({ ids: ["b", "a"], folders: ["x"] });
});
