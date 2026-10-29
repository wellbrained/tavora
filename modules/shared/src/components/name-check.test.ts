import { describe, expect, it } from "vitest";
import { checkName } from "./name-check";

describe("checkName", () => {
  it("accepts a normal name", () => expect(checkName("Waystone", 20)).toBeNull());
  it("refuses an empty or blank name", () => {
    expect(checkName("", 20)).toBe("empty");
    expect(checkName("   ", 20)).toBe("empty");
  });
  it("counts the trimmed name against the limit", () => {
    expect(checkName(`  ${"a".repeat(20)}  `, 20)).toBeNull();
    expect(checkName("a".repeat(21), 20)).toBe("tooLong");
  });
  it("defaults to 100 characters", () => {
    expect(checkName("a".repeat(100))).toBeNull();
    expect(checkName("a".repeat(101))).toBe("tooLong");
  });
});
