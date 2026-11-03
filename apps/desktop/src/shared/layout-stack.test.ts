import { describe, expect, it } from "vitest";
import { alignRect } from "./layout-math";
import { arrange, stackOrder } from "./layout-stack";

describe("arrange", () => {
  const order = ["a", "b", "c", "d"];
  it("goes to the front or the back", () => {
    expect(arrange(order, ["b"], "front")).toEqual(["a", "c", "d", "b"]);
    expect(arrange(order, ["c"], "back")).toEqual(["c", "a", "b", "d"]);
  });
  it("goes one step", () => {
    expect(arrange(order, ["b"], "forward")).toEqual(["a", "c", "b", "d"]);
    expect(arrange(order, ["c"], "backward")).toEqual(["a", "c", "b", "d"]);
  });
  it("stops at the ends", () => {
    expect(arrange(order, ["d"], "forward")).toEqual(order);
    expect(arrange(order, ["a"], "backward")).toEqual(order);
  });
  it("moves several together and keeps their order", () => {
    expect(arrange(order, ["a", "c"], "forward")).toEqual(["b", "a", "d", "c"]);
    expect(arrange(order, ["b", "c"], "forward")).toEqual(["a", "d", "b", "c"]);
    expect(arrange(order, ["d", "b"], "back")).toEqual(["b", "d", "a", "c"]);
  });
});

describe("stackOrder", () => {
  it("puts frames without a place above those with one, in the order given", () => {
    const items = [{ id: "a", z: null }, { id: "b", z: 1 }, { id: "c", z: 0 }, { id: "d", z: null }];
    expect(stackOrder(items).map((item) => item.id)).toEqual(["c", "b", "a", "d"]);
  });
});

describe("alignRect", () => {
  const canvas = { width: 1920, height: 1080 };
  const rect = { x: 500, y: 300, width: 400, height: 200 };
  it("sets one axis and leaves the other", () => {
    expect(alignRect(rect, canvas, "left")).toEqual({ ...rect, x: 0 });
    expect(alignRect(rect, canvas, "center")).toEqual({ ...rect, x: 760 });
    expect(alignRect(rect, canvas, "right")).toEqual({ ...rect, x: 1520 });
    expect(alignRect(rect, canvas, "top")).toEqual({ ...rect, y: 0 });
    expect(alignRect(rect, canvas, "middle")).toEqual({ ...rect, y: 440 });
    expect(alignRect(rect, canvas, "bottom")).toEqual({ ...rect, y: 880 });
  });
});
