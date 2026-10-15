import { describe, expect, it } from "vitest";
// @ts-expect-error - plain JavaScript module shared with scripts/release.mjs
import { checkRelease, compareVersions, lastReleased } from "./release-guards.mjs";

const ready = { branch: "main", dirty: false, ahead: 0, behind: 0, tags: [] as string[], noteVersions: ["0.4.0"] };

describe("compareVersions", () => {
  it("orders by major, minor and patch as numbers", () => {
    expect(compareVersions("0.10.0", "0.9.0")).toBe(1);
    expect(compareVersions("1.0.0", "0.99.99")).toBe(1);
    expect(compareVersions("0.3.2", "0.3.10")).toBe(-1);
    expect(compareVersions("0.4.0", "0.4.0")).toBe(0);
    expect(() => compareVersions("0.4", "0.4.0")).toThrow();
  });
});

describe("lastReleased", () => {
  it("is the newest v-tag by version, not by name, and null without tags", () => {
    expect(lastReleased(["v0.4.0", "v0.10.0", "v0.9.0", "nightly", "v0.10.0-rc.1"])).toBe("0.10.0");
    expect(lastReleased([])).toBeNull();
    expect(lastReleased(["docs-live"])).toBeNull();
  });
});

describe("checkRelease", () => {
  it("lets a clean main with a minor version and matching notes go", () => {
    expect(checkRelease("0.4.0", ready)).toEqual([]);
    expect(checkRelease("1.0.0", { ...ready, noteVersions: ["1.0.0"], tags: ["v0.9.0"] })).toEqual([]);
  });

  it("never publishes a patch version", () => {
    const problems = checkRelease("0.4.1", { ...ready, noteVersions: ["0.4.1"] });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("patch version");
  });

  it("publishes a patch version only when asked for a one-off", () => {
    const state = { ...ready, tags: ["v0.4.0"], noteVersions: ["0.4.1", "0.4.0"] };
    expect(checkRelease("0.4.1", state, { allowPatch: true })).toEqual([]);
    expect(checkRelease("0.4.1", state)[0]).toContain("--allow-patch");
    // The other guards still apply: not newer, wrong notes.
    expect(checkRelease("0.4.0", { ...state, noteVersions: ["0.4.0"] }, { allowPatch: true }).join(" ")).toContain("already released");
    expect(checkRelease("0.4.1", { ...state, noteVersions: ["0.4.0"] }, { allowPatch: true }).join(" ")).toContain("newest patch-notes entry");
  });

  it("wants main, clean and level with origin/main", () => {
    expect(checkRelease("0.4.0", { ...ready, branch: "feat/x" })[0]).toContain("from main");
    expect(checkRelease("0.4.0", { ...ready, dirty: true })[0]).toContain("uncommitted");
    expect(checkRelease("0.4.0", { ...ready, behind: 2 })[0]).toContain("2 commit(s) behind");
    expect(checkRelease("0.4.0", { ...ready, ahead: 1 })[0]).toContain("1 commit(s) ahead");
  });

  it("refuses a version that is already released or not newer than the last one", () => {
    expect(checkRelease("0.4.0", { ...ready, tags: ["v0.4.0"] }).join(" ")).toContain("already released");
    expect(checkRelease("0.4.0", { ...ready, tags: ["v0.5.0"] }).join(" ")).toContain("not newer than the last release 0.5.0");
  });

  it("wants the newest patch-notes entry to be this version", () => {
    expect(checkRelease("0.4.0", { ...ready, noteVersions: ["0.3.2", "0.3.1"] }).join(" ")).toContain("newest patch-notes entry is 0.3.2");
    expect(checkRelease("0.4.0", { ...ready, noteVersions: [] }).join(" ")).toContain("missing");
  });

  it("wants the entries since the last release folded into the new one", () => {
    const folded = checkRelease("0.4.0", { ...ready, noteVersions: ["0.4.0", "0.3.2", "0.3.0"] });
    expect(folded.join(" ")).toContain("Fold the patch-notes entries 0.3.2, 0.3.0");
    // Entries at or before the last release are history and stay.
    expect(checkRelease("0.5.0", { ...ready, tags: ["v0.4.0"], noteVersions: ["0.5.0", "0.4.0", "0.3.2"] })).toEqual([]);
    expect(checkRelease("0.5.0", { ...ready, tags: ["v0.4.0"], noteVersions: ["0.5.0", "0.4.2", "0.4.0"] }).join(" ")).toContain("0.4.2");
  });

  it("reports every problem at once", () => {
    const problems = checkRelease("0.4.1", { ...ready, branch: "x", dirty: true, noteVersions: ["0.4.0"] });
    expect(problems.length).toBeGreaterThanOrEqual(4);
  });

  it("rejects a version that is not major.minor.patch", () => {
    expect(checkRelease("0.4.0-rc.1", ready)[0]).toContain("not major.minor.patch");
  });
});
