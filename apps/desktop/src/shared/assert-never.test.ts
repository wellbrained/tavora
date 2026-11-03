import { describe, expect, it } from "vitest";
import { assertNever } from "./assert-never";

describe("assertNever", () => {
  it("throws for a value no case handled, naming it", () => {
    expect(() => assertNever({ phase: "later" } as never)).toThrow('Unexpected value: {"phase":"later"}');
  });
});
