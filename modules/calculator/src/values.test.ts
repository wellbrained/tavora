import { describe, expect, it } from "vitest";
import { deleteValue, isValidName, lookup, MAX_VALUES, parseValues, renameValue, saveValue, type Value } from "./values";

const iron: Value = { name: "Iron", value: "100" };

describe("values", () => {
  it("take names of letters and digits only", () => {
    expect(isValidName("iron2")).toBe(true);
    expect(isValidName("Eisenbarren")).toBe(true);
    expect(isValidName("Größe")).toBe(true);
    expect(isValidName("")).toBe(false);
    expect(isValidName("iron bar")).toBe(false);
    expect(isValidName("a-b")).toBe(false);
    expect(isValidName("x".repeat(21))).toBe(false);
  });

  it("keep only valid entries", () => {
    expect(parseValues(null)).toEqual([]);
    expect(parseValues([iron, { name: "iron", value: "5" }, { name: "bad name", value: "1" }, { name: "x", value: "abc" }, null])).toEqual([iron]);
  });

  it("put the newest first and replace the same name", () => {
    const saved = saveValue(saveValue([iron], { name: "copper", value: "2" })!, { name: "IRON", value: "7" })!;
    expect(saved).toEqual([{ name: "IRON", value: "7" }, { name: "copper", value: "2" }]);
  });

  it("keep 30 at most", () => {
    const full = Array.from({ length: MAX_VALUES }, (_, n) => ({ name: `v${n}`, value: `${n}` }));
    expect(saveValue(full, { name: "new", value: "1" })).toBeNull();
    expect(saveValue(full, { name: "V3", value: "9" })![0]).toEqual({ name: "V3", value: "9" });
  });

  it("rename in place, but not onto another value", () => {
    const values = [iron, { name: "copper", value: "2" }];
    expect(renameValue(values, "copper", "Kupfer")).toEqual([iron, { name: "Kupfer", value: "2" }]);
    expect(renameValue(values, "iron", "IRON")).toEqual([{ name: "IRON", value: "100" }, values[1]]);
    expect(renameValue(values, "copper", "iron")).toBeNull();
  });

  it("delete and look up by name, whatever the case", () => {
    expect(lookup([iron])("iron")).toBe(100);
    expect(lookup(deleteValue([iron], "IRON"))("iron")).toBeUndefined();
  });
});
