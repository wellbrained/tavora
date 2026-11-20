import { describe, expect, it } from "vitest";
import { sameOwner, viewsOfAnotherOwner } from "./module-owner";

const catalog = { owner: "k1", manifest: { id: "x" } };
const local = { owner: "local", manifest: { id: "x" } };

describe("sameOwner", () => {
  it("finds the copy installed now when it is the same owner's", () => {
    const now = { ...catalog };
    expect(sameOwner(catalog, new Map([["x", now]]))).toBe(now);
  });

  it("finds nothing once a development folder shadows the module under its id", () => {
    expect(sameOwner(catalog, new Map([["x", local]]))).toBeUndefined();
    expect(sameOwner(local, new Map([["x", catalog]]))).toBeUndefined();
  });

  it("finds nothing for a module that is gone", () => {
    expect(sameOwner(catalog, new Map())).toBeUndefined();
  });
});

describe("viewsOfAnotherOwner", () => {
  it("picks the open views whose id is installed now for another owner", () => {
    const views = [
      { moduleId: "x", owner: "k1", name: "shadowed" },
      { moduleId: "y", owner: "k1", name: "same owner" },
      { moduleId: "z", owner: "k1", name: "gone" },
    ];
    const installed = new Map([
      ["x", { owner: "local" }],
      ["y", { owner: "k1" }],
    ]);
    expect(viewsOfAnotherOwner(views, installed).map((view) => view.name)).toEqual(["shadowed"]);
  });
});
