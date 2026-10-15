import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("app version", () => {
  const { version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };

  it("is major.minor.patch", () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("has left 0.0.0, the version before releases were numbered", () => {
    expect(version).not.toBe("0.0.0");
  });
});
