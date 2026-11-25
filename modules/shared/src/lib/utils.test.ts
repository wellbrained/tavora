import { describe, expect, it } from "vitest";
import { readEntries, withKept } from "./utils";

type Row = { id: string };
const read = (entry: unknown): Row | "newer" | null => {
  if (typeof entry !== "object" || entry === null || typeof (entry as Row).id !== "string") return null;
  return (entry as { kind?: string }).kind === "newer" ? "newer" : { id: (entry as Row).id };
};
const id = (row: Row) => row.id;

describe("readEntries and withKept", () => {
  it("keeps entries a newer version wrote in their place, and drops broken ones", () => {
    const raw = [{ id: "n0", kind: "newer" }, { id: "a" }, { id: "n1", kind: "newer", extra: [1] }, { id: "n2", kind: "newer" }, "broken", { id: "b" }];
    const { entries, kept } = readEntries(raw, read);
    expect(entries).toEqual([{ id: "a" }, { id: "b" }]);
    expect(withKept(entries, kept, id)).toEqual(raw.filter((entry) => entry !== "broken"));
  });

  it("puts a kept entry after the one it followed, also when entries were added or moved", () => {
    const { entries, kept } = readEntries([{ id: "a" }, { id: "n", kind: "newer" }, { id: "b" }], read);
    expect(withKept([{ id: "c" }, ...entries.reverse()], kept, id)).toEqual([{ id: "c" }, { id: "b" }, { id: "a" }, { id: "n", kind: "newer" }]);
  });

  it("keeps a kept entry at the end when the one it followed was deleted", () => {
    const { kept } = readEntries([{ id: "a" }, { id: "n", kind: "newer" }, { id: "b" }], read);
    expect(withKept([{ id: "b" }], kept, id)).toEqual([{ id: "b" }, { id: "n", kind: "newer" }]);
  });

  it("does not loop on repeated ids", () => {
    const { entries, kept } = readEntries([{ id: "x", kind: "newer" }, { id: "x", kind: "newer" }], read);
    expect(withKept(entries, kept, id)).toHaveLength(2);
  });
});
