import { describe, expect, it } from "vitest";
// @ts-expect-error - plain JavaScript module run by .github/workflows/version.yml
import { checkVersionBump } from "./version-bump.mjs";

describe("checkVersionBump", () => {
  it("lets an unchanged version or a patch raise through", () => {
    expect(checkVersionBump("0.14.0", "0.14.0", false)).toEqual([]);
    expect(checkVersionBump("0.14.0", "0.14.1", false)).toEqual([]);
    expect(checkVersionBump("0.14.9", "0.14.10", false)).toEqual([]);
  });

  it("refuses a minor or major raise without the label", () => {
    expect(checkVersionBump("0.14.3", "0.15.0", false)[0]).toContain("0.14.4");
    expect(checkVersionBump("0.14.3", "1.0.0", false)[0]).toContain("major");
  });

  it("lets a labeled minor or major raise through when it starts at patch 0", () => {
    expect(checkVersionBump("0.14.3", "0.15.0", true)).toEqual([]);
    expect(checkVersionBump("0.99.2", "1.0.0", true)).toEqual([]);
    expect(checkVersionBump("0.14.3", "0.15.1", true)[0]).toContain("patch 0");
  });

  it("refuses a lower version, and the label on a patch raise", () => {
    expect(checkVersionBump("0.14.0", "0.13.5", false)[0]).toContain("goes down");
    expect(checkVersionBump("0.14.0", "0.14.1", true)[0]).toContain("remove the label");
  });
});
