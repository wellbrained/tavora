import { describe, expect, it } from "vitest";
import { moduleTag, type TaggedModule } from "./module-tag";

const module = (overrides: Partial<TaggedModule> & Pick<TaggedModule, "origin">): TaggedModule => ({
  id: "wellbrained.satisfactory",
  provenance: "local",
  fromCatalog: false,
  ...overrides,
});

describe("moduleTag", () => {
  it("calls Tavora's own modules Official", () => {
    expect(moduleTag(module({ id: "tavora.notes", provenance: "official", origin: { kind: "official" } }))).toBe("official");
  });

  it("tells a catalog install from one added from a zip file", () => {
    expect(moduleTag(module({ origin: { kind: "own" }, fromCatalog: true }))).toBe("catalog");
    expect(moduleTag(module({ origin: { kind: "own" }, fromCatalog: false }))).toBe("file");
  });

  it("keeps Local and Release for development folders", () => {
    expect(moduleTag(module({ id: "local.satisfactory", origin: { kind: "dev" } }))).toBe("local");
    expect(moduleTag(module({ origin: { kind: "dev" } }))).toBe("release");
  });

  it("calls the examples that ship with Tavora Example", () => {
    expect(moduleTag(module({ id: "example.vue", origin: { kind: "example" } }))).toBe("example");
  });
});
