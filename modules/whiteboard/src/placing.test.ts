import { describe, expect, it } from "vitest";
import { createPlacing, type PlacingElement } from "./placing";

const picture = (id: string, extra: Partial<PlacingElement> = {}): PlacingElement => ({ id, type: "image", fileId: "file", ...extra });
const none = {};

describe("locking a new picture once it is placed", () => {
  it("leaves a picture free while it is selected, and locks it once it is let go of", () => {
    const placing = createPlacing([]);
    expect(placing.observe([picture("a")], { a: true })).toEqual([]);
    expect(placing.observe([picture("a")], { a: true })).toEqual([]);
    expect(placing.observe([picture("a")], none)).toEqual(["a"]);
    // Once only.
    expect(placing.observe([picture("a")], none)).toEqual([]);
  });

  it("waits for the file, which Excalidraw gives a new picture a moment after its element", () => {
    const placing = createPlacing([]);
    expect(placing.observe([picture("a", { fileId: null })], none)).toEqual([]);
    expect(placing.observe([picture("a")], none)).toEqual(["a"]);
  });

  it("never locks a picture that was on the board when it opened", () => {
    const placing = createPlacing([picture("old"), { id: "box", type: "rectangle" }]);
    expect(placing.observe([picture("old")], none)).toEqual([]);
  });

  it("never locks the picture of a card, which locks with its group", () => {
    const placing = createPlacing([]);
    expect(placing.observe([picture("card", { customData: { whiteboardCard: "picture" } })], none)).toEqual([]);
  });

  it("ignores deleted pictures and other elements", () => {
    const placing = createPlacing([]);
    expect(placing.observe([picture("gone", { isDeleted: true }), { id: "r", type: "rectangle" }], none)).toEqual([]);
    // A deleted picture that comes back with Undo is not new any more only if it was seen: it was not, so it waits.
    expect(placing.observe([picture("gone")], none)).toEqual(["gone"]);
  });

  it("locks several pictures that are let go of together", () => {
    const placing = createPlacing([]);
    expect(placing.observe([picture("a"), picture("b")], { b: true })).toEqual(["a"]);
    expect(placing.observe([picture("a"), picture("b")], none)).toEqual(["b"]);
  });

  it("stops waiting for a picture the user locked or freed by hand", () => {
    const placing = createPlacing([]);
    placing.observe([picture("a")], { a: true });
    placing.release("a");
    expect(placing.observe([picture("a")], none)).toEqual([]);
  });
});
