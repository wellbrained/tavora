import { describe, expect, it } from "vitest";
// @ts-expect-error - plain JavaScript module shared with scripts/release.mjs
import { CHECKLIST, asksHandChecks, checkCi, checkDownload, checkInstalled, checkRelease, compareVersions, findDispatchedRun, lastReleased, readCiHashes, releaseFiles, releaseNotes, releaseRunTitle } from "./release-guards.mjs";

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

  it("publishes a patch version like any other (decided 2026-10-30)", () => {
    const state = { ...ready, tags: ["v0.4.0"], noteVersions: ["0.4.1", "0.4.0"] };
    expect(checkRelease("0.4.1", state)).toEqual([]);
    // The other guards still apply: not newer, wrong notes.
    expect(checkRelease("0.4.0", { ...state, noteVersions: ["0.4.0"] }).join(" ")).toContain("already released");
    expect(checkRelease("0.4.1", { ...state, noteVersions: ["0.4.0"] }).join(" ")).toContain("newest patch-notes entry");
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

describe("checkCi", () => {
  const SHA = "4c52cdd48cb60e8499bef9ec49c57fe8858c95b5";
  const run = (status: string, conclusion: string | null, createdAt: string, headSha = SHA) => ({ status, conclusion, headSha, createdAt });

  it("passes when the newest run for the commit finished green", () => {
    expect(checkCi([run("completed", "success", "2026-10-16T10:00:00Z")], SHA)).toEqual([]);
  });

  it("goes by the newest run: a green rerun fixes a red one, a red one after green does not", () => {
    expect(checkCi([run("completed", "failure", "2026-10-16T10:00:00Z"), run("completed", "success", "2026-10-16T10:05:00Z")], SHA)).toEqual([]);
    expect(checkCi([run("completed", "success", "2026-10-16T10:00:00Z"), run("completed", "failure", "2026-10-16T10:05:00Z")], SHA)[0]).toContain("failure");
  });

  it("waits for runs that are not done and for commits GitHub has not seen", () => {
    expect(checkCi([run("in_progress", null, "2026-10-16T10:00:00Z")], SHA)[0]).toContain("in_progress");
    expect(checkCi([run("completed", "success", "2026-10-16T10:00:00Z", "other")], SHA)[0]).toContain("no Checks run");
    expect(checkCi([], SHA)).toHaveLength(1);
  });
});

describe("checkInstalled", () => {
  it("passes when the version being released is installed", () => {
    expect(checkInstalled("0.17.5", "0.17.5")).toBeUndefined();
  });

  it("refuses an older install, which is how 0.17.3 got through", () => {
    expect(checkInstalled("0.17.0", "0.17.3")).toContain("installed Tavora is 0.17.0, not 0.17.3");
  });

  it("refuses when Tavora is not installed", () => {
    expect(checkInstalled(null, "0.17.5")).toContain("not installed");
  });
});

describe("CHECKLIST", () => {
  it("has the four by-hand checks that can be made before publishing", () => {
    expect(CHECKLIST).toHaveLength(4);
  });

  it("names what covers each check automatically", () => {
    for (const item of CHECKLIST) expect(item.coveredBy).toBeTruthy();
  });
});

describe("asksHandChecks", () => {
  it("lists the checks without asking before 1.0", () => {
    expect(asksHandChecks("0.21.13")).toBe(false);
  });

  it("asks them again from 1.0.0 on", () => {
    expect(asksHandChecks("1.0.0")).toBe(true);
    expect(asksHandChecks("1.2.3")).toBe(true);
  });
});

describe("the split release (CI builds, the PC checks and uploads)", () => {
  const sha = "a".repeat(40);
  const title = releaseRunTitle("0.24.0", true, "n0nce");
  const run = (over: object) => ({ databaseId: 1, headSha: sha, displayTitle: title, status: "queued", event: "workflow_dispatch", ...over });

  it("finds exactly the run it started (by its nonce), waits while GitHub hasn't listed it, and stops when main moved", () => {
    expect(title).toBe("Release build 0.24.0 e2e=true (n0nce)");
    expect(findDispatchedRun([], title, sha)).toEqual({ wait: true });
    // Someone else's run of the same commit, even a newer one or one without e2e, is never taken.
    expect(findDispatchedRun([run({ databaseId: 9, displayTitle: releaseRunTitle("0.24.0", false, "other") })], title, sha)).toEqual({ wait: true });
    expect(findDispatchedRun([run({ event: "push" })], title, sha)).toEqual({ wait: true });
    expect(findDispatchedRun([run({ databaseId: 9, displayTitle: "Release build 0.24.0 e2e=true (x)" }), run({ databaseId: 2 })], title, sha).run?.databaseId).toBe(2);
    expect(findDispatchedRun([run({ headSha: "b".repeat(40) })], title, sha).problem).toContain("main moved");
  });

  it("reads the hashes CI printed, with the runner's log prefixes", () => {
    const log = `package\tSHA-256\t2026-10-31T12:20:00.0000000Z RELEASE-SHA256 ${"c".repeat(64)}  Tavora-Setup-0.24.0.exe\r\npackage\tSHA-256\t2026-10-31T12:20:00.1Z RELEASE-SHA256 ${"d".repeat(64)}  latest.yml\n`;
    const hashes = readCiHashes(log);
    expect(hashes.get("Tavora-Setup-0.24.0.exe")).toBe("c".repeat(64));
    expect(hashes.get("latest.yml")).toBe("d".repeat(64));
    // The summary step's own script text must not count: it has no 64-hex hash.
    expect(readCiHashes('$line = "RELEASE-SHA256 $(...)  $name"').size).toBe(0);
  });

  it("accepts only the files CI built, with a latest.yml that names this installer", () => {
    const version = "0.24.0";
    const { all } = releaseFiles(version);
    const downloaded = new Map(all.map((name, i) => [name, { sha256: String(i).repeat(64), sha512: "SHA512==" }]));
    const ci = new Map(all.map((name, i) => [name, String(i).repeat(64)]));
    const yml = "version: 0.24.0\nfiles:\n  - url: Tavora-Setup-0.24.0.exe\n    sha512: SHA512==\npath: Tavora-Setup-0.24.0.exe\nsha512: SHA512==\n";
    expect(checkDownload(version, downloaded, ci, yml)).toEqual([]);
    expect(checkDownload(version, downloaded, new Map([...ci, ["latest.yml", "f".repeat(64)]]), yml).join(" ")).toContain("latest.yml is not the file");
    expect(checkDownload(version, new Map([...downloaded].slice(1)), ci, yml).join(" ")).toContain("Tavora-Setup-0.24.0.exe is missing");
    expect(checkDownload(version, downloaded, ci, yml.replace(/^sha512: .*$/m, "sha512: OTHER==")).join(" ")).toContain("sha512 is not the installer's");
    expect(checkDownload(version, downloaded, ci, yml.replace("version: 0.24.0", "version: 0.23.0")).join(" ")).toContain("does not say version");
  });

  it("writes the GitHub release text from the patch notes", () => {
    expect(releaseNotes({ version: "0.24.0", notes: ["One.", "Two."] })).toContain("### In 0.24.0\n\n- One.\n- Two.");
  });
});
