import { describe, expect, it } from "vitest";
import { copyScale, elementsToCopy, MAX_PIXELS, MAX_SIDE, SHARP_SCALE } from "./copy";

const element = (id: string, extra: { isDeleted?: boolean; containerId?: string; frameId?: string } = {}) => ({ id, isDeleted: false, ...extra });

describe("elementsToCopy", () => {
  const board = [element("box"), element("label", { containerId: "box" }), element("frame"), element("inFrame", { frameId: "frame" }), element("loose"), element("gone", { isDeleted: true })];
  const ids = (list: { id: string }[]) => list.map((item) => item.id);

  it("copies the whole board, without deleted elements, when nothing is selected", () => {
    expect(ids(elementsToCopy(board, {}))).toEqual(["box", "label", "frame", "inFrame", "loose"]);
  });

  it("copies a selected shape with the text inside it", () => {
    expect(ids(elementsToCopy(board, { box: true }))).toEqual(["box", "label"]);
  });

  it("copies a selected frame with what lies in it", () => {
    expect(ids(elementsToCopy(board, { frame: true }))).toEqual(["frame", "inFrame"]);
  });

  it("ignores selected ids that are deleted or not on the board", () => {
    expect(ids(elementsToCopy(board, { gone: true, elsewhere: true }))).toEqual(["box", "label", "frame", "inFrame", "loose"]);
    expect(ids(elementsToCopy(board, { gone: true, loose: true }))).toEqual(["loose"]);
  });
});

describe("copyScale", () => {
  it("copies an ordinary drawing at twice its size", () => {
    expect(copyScale(800, 600)).toBe(SHARP_SCALE);
  });

  it("keeps the longest side within the limit", () => {
    const scale = copyScale(20_000, 500);
    expect(20_000 * scale).toBeCloseTo(MAX_SIDE);
  });

  it("keeps the number of pixels within the limit", () => {
    const scale = copyScale(6000, 6000);
    expect(6000 * scale * 6000 * scale).toBeLessThanOrEqual(MAX_PIXELS + 1);
    expect(6000 * scale).toBeLessThanOrEqual(MAX_SIDE);
  });

  it("falls back to 1 for an empty size", () => {
    expect(copyScale(0, 100)).toBe(1);
    expect(copyScale(Number.NaN, 100)).toBe(1);
  });
});
