import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PAGE, withIndex } from "./protocol-index.ts";

describe("reference/protocol.md", () => {
  it("has the method index the table in packages/sdk/src/protocol.ts generates (run `pnpm --filter @tavora/docs protocol` when this fails)", () => {
    const page = readFileSync(PAGE, "utf8").replace(/\r\n/g, "\n");
    expect(page).toBe(withIndex(page));
  });
});
