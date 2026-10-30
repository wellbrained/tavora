import { describe, expect, it } from "vitest";
import { checkRename, dropPlace, moveTab, neighbourAfterClose, stepTab } from "./tab-strip";

describe("moveTab", () => {
  const ids = ["a", "b", "c", "d"];
  it("puts a tab before or after the target", () => {
    expect(moveTab(ids, "d", "b", false)).toEqual(["a", "d", "b", "c"]);
    expect(moveTab(ids, "a", "c", true)).toEqual(["b", "c", "a", "d"]);
    expect(moveTab(ids, "a", "d", true)).toEqual(["b", "c", "d", "a"]);
  });
  it("leaves the order alone for the tab itself or an unknown id", () => {
    expect(moveTab(ids, "b", "b", true)).toEqual(ids);
    expect(moveTab(ids, "x", "b", true)).toEqual(ids);
    expect(moveTab(ids, "b", "x", true)).toEqual(ids);
  });
  it("gives the same order when dropped where it already is", () => {
    expect(moveTab(ids, "b", "a", true)).toEqual(ids);
    expect(moveTab(ids, "b", "c", false)).toEqual(ids);
  });
});

describe("stepTab", () => {
  it("moves one place and stops at the ends", () => {
    expect(stepTab(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(stepTab(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
    expect(stepTab(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
    expect(stepTab(["a", "b", "c"], "c", 1)).toEqual(["a", "b", "c"]);
    expect(stepTab(["a", "b", "c"], "x", 1)).toEqual(["a", "b", "c"]);
  });
});

describe("neighbourAfterClose", () => {
  it("picks the next tab, else the one before, else nothing", () => {
    expect(neighbourAfterClose(["a", "b", "c"], "b")).toBe("c");
    expect(neighbourAfterClose(["a", "b", "c"], "c")).toBe("b");
    expect(neighbourAfterClose(["a"], "a")).toBeNull();
    expect(neighbourAfterClose(["a", "b"], "x")).toBeNull();
  });
});

describe("dropPlace", () => {
  const boxes = [
    { id: "a", left: 0, right: 100 },
    { id: "b", left: 100, right: 200 },
  ];
  it("splits a tab into its left and right half", () => {
    expect(dropPlace(boxes, 120)).toEqual({ target: "b", after: false });
    expect(dropPlace(boxes, 180)).toEqual({ target: "b", after: true });
  });
  it("snaps to the first and last tab outside the row", () => {
    expect(dropPlace(boxes, -20)).toEqual({ target: "a", after: false });
    expect(dropPlace(boxes, 260)).toEqual({ target: "b", after: true });
  });
  it("has no place without tabs", () => {
    expect(dropPlace([], 10)).toBeNull();
  });
});

describe("checkRename", () => {
  it("accepts a new name, trimmed", () => {
    expect(checkRename("Plan", "  Iron  ")).toEqual({ kind: "rename", label: "Iron" });
  });
  it("treats the same name as no change", () => {
    expect(checkRename("Plan", " Plan ")).toEqual({ kind: "unchanged" });
  });
  it("rejects an empty or too long name", () => {
    expect(checkRename("Plan", "   ")).toEqual({ kind: "invalid", problem: "empty" });
    expect(checkRename("Plan", "x".repeat(11), 10)).toEqual({ kind: "invalid", problem: "tooLong" });
    expect(checkRename("Plan", "x".repeat(10), 10)).toEqual({ kind: "rename", label: "x".repeat(10) });
  });
});
