import { describe, expect, it } from "vitest";
import { checkSdkRelease } from "./release-sdk-guards.mjs";

const ready = {
  branch: "main",
  dirty: false,
  ahead: 0,
  behind: 0,
  packages: [
    { name: "@tavora/sdk", version: "0.2.1", changelog: "# Changelog\n\n## 0.2.1\n\n- New\n", published: ["0.2.0"] },
    { name: "@tavora/pack", version: "0.1.0", changelog: "## 0.1.0\r\n", published: ["0.1.0"] },
  ],
};

describe("checkSdkRelease", () => {
  it("publishes only the packages whose version is not on npm yet", () => {
    expect(checkSdkRelease(ready)).toEqual({ problems: [], toPublish: ["@tavora/sdk"] });
  });

  it("needs a clean main that matches origin", () => {
    const { problems } = checkSdkRelease({ ...ready, branch: "feature", dirty: true, ahead: 1, behind: 2 });
    expect(problems).toHaveLength(4);
  });

  it("needs a changelog entry for every version it publishes", () => {
    const packages = [{ ...ready.packages[0]!, changelog: "## 0.2.0\n" }, { ...ready.packages[1]!, changelog: null }];
    expect(checkSdkRelease({ ...ready, packages }).problems).toEqual(['@tavora/sdk: CHANGELOG.md has no "## 0.2.1" entry.']);
  });

  it("refuses when there is nothing new to publish", () => {
    const packages = ready.packages.map((pkg) => ({ ...pkg, published: [pkg.version] }));
    expect(checkSdkRelease({ ...ready, packages }).problems).toEqual([expect.stringContaining("already on npm")]);
  });

  it("refuses a version that is not major.minor.patch", () => {
    const packages = [{ ...ready.packages[0]!, version: "0.3.0-beta.1" }];
    expect(checkSdkRelease({ ...ready, packages }).problems).toEqual([expect.stringContaining("not major.minor.patch")]);
  });
});
