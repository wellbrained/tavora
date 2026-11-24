import { describe, expect, it } from "vitest";
import { checkRename, moveTab, neighbourAfterClose, neighbourTab, revealBy, stepTab, tabsOutOfView } from "./tab-strip";

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

describe("tabsOutOfView", () => {
  const row = { left: 100, right: 300 };
  const tab = (id: string, left: number, right: number) => ({ id, left, right });
  it("names the tabs cut off on either side, in order", () => {
    const tabs = [tab("a", 20, 110), tab("b", 110, 200), tab("c", 200, 290), tab("d", 290, 380)];
    expect(tabsOutOfView(row, tabs)).toEqual({ hidden: ["a", "d"], before: true, after: true });
  });
  it("says only the side that has hidden tabs", () => {
    expect(tabsOutOfView(row, [tab("a", 100, 200), tab("b", 200, 350)])).toEqual({ hidden: ["b"], before: false, after: true });
    expect(tabsOutOfView(row, [tab("a", 0, 100), tab("b", 100, 300)])).toEqual({ hidden: ["a"], before: true, after: false });
  });
  it("lets a tab stick out by a pixel of rounding", () => {
    expect(tabsOutOfView(row, [tab("a", 99.5, 200), tab("b", 200, 301)])).toEqual({ hidden: [], before: false, after: false });
  });
});

describe("revealBy", () => {
  const row = { left: 100, right: 300 };
  it("scrolls a tab in from either side, and leaves one in view", () => {
    expect(revealBy(row, { left: 280, right: 360 })).toBe(60);
    expect(revealBy(row, { left: 40, right: 120 })).toBe(-60);
    expect(revealBy(row, { left: 120, right: 280 })).toBe(0);
  });
  it("shows the start of a tab wider than the row", () => {
    expect(revealBy(row, { left: 150, right: 500 })).toBe(50);
  });
});

describe("neighbourTab", () => {
  it("gives the tab before or after, and nothing past the ends", () => {
    expect(neighbourTab(["a", "b", "c"], "b", -1)).toBe("a");
    expect(neighbourTab(["a", "b", "c"], "b", 1)).toBe("c");
    expect(neighbourTab(["a", "b", "c"], "a", -1)).toBeNull();
    expect(neighbourTab(["a", "b", "c"], "c", 1)).toBeNull();
    expect(neighbourTab(["a", "b"], "x", 1)).toBeNull();
    expect(neighbourTab(["a", "b"], undefined, 1)).toBeNull();
  });
});
