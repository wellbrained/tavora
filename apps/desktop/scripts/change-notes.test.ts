import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error - plain JavaScript module run by .github/workflows/version.yml and number.yml
import { applyNotes, checkPullRequest, collectPullRequest, mergeTags, nextVersion, parseChangeNote, pullRequestOf, renderEntry, tagsForFiles, today } from "./change-notes.mjs";

describe("parseChangeNote", () => {
  it("reads a title and notes, and raises the patch number by default", () => {
    const { note, problems } = parseChangeNote("# Lost a key?\n\n- Press Lost it?\n- Your modules move\n  to your newest key.\n", "a.md");
    expect(problems).toEqual([]);
    expect(note).toEqual({ bump: "patch", title: "Lost a key?", notes: ["Press Lost it?", "Your modules move to your newest key."], tags: [] });
  });

  it("reads a bump on the first line, with Windows line ends", () => {
    expect(parseChangeNote("bump: minor\r\n# The catalog\r\n- Browse modules\r\n", "a.md").note?.bump).toBe("minor");
  });

  it("names what is missing or wrong", () => {
    expect(parseChangeNote("- A note\n", "a.md").problems[0]).toContain("Title");
    expect(parseChangeNote("# Title\n", "a.md").problems[0]).toContain("note");
    expect(parseChangeNote("bump: huge\n# Title\n- A note\n", "a.md").problems[0]).toContain("huge");
    expect(parseChangeNote("# Title\nSome words\n- A note\n", "a.md").problems[0]).toContain("Some words");
    expect(parseChangeNote("# Title\n- A note\nbump: minor\n", "a.md").note?.notes).toEqual(["A note bump: minor"]);
  });
});

describe("nextVersion", () => {
  it("raises patch, minor or major", () => {
    expect(nextVersion("0.19.15", "patch")).toBe("0.19.16");
    expect(nextVersion("0.19.15", "minor")).toBe("0.20.0");
    expect(nextVersion("0.19.15", "major")).toBe("1.0.0");
  });
});

describe("checkPullRequest", () => {
  const patch = { bump: "patch", title: "T", notes: ["n"] };
  const minor = { ...patch, bump: "minor" };
  const pr = (over: object) => checkPullRequest({ base: "0.19.15", head: "0.19.15", rootHead: "0.19.15", notes: [], featureComplete: false, ...over });

  it("lets a pull request through that leaves the version alone, with or without notes", () => {
    expect(pr({})).toEqual([]);
    expect(pr({ notes: [patch] })).toEqual([]);
    expect(pr({ notes: [minor], featureComplete: true })).toEqual([]);
  });

  it("refuses a version raised by hand, in either package.json", () => {
    expect(pr({ head: "0.19.16", rootHead: "0.19.16" })[0]).toContain("change note");
    expect(pr({ rootHead: "0.19.16" })[0]).toContain("change note");
  });

  it("needs the label for a minor note, and a minor note for the label", () => {
    expect(pr({ notes: [minor] })[0]).toContain("feature-complete");
    expect(pr({ notes: [patch], featureComplete: true })[0]).toContain("remove the label");
  });
});

describe("applyNotes", () => {
  const source = 'export const PATCH_NOTES: readonly PatchNote[] = [\n  {\n    version: "0.19.15",\n  },\n];\n';

  it("gives each note its own number, oldest first, newest entry on top", () => {
    const result = applyNotes(
      "0.19.15",
      source,
      [
        { bump: "patch", title: "First", notes: ['Say "hi"'] },
        { bump: "minor", title: "Second", notes: ["Two", "Three"] },
      ],
      "2026-10-20",
    );
    expect(result.versions).toEqual(["0.19.16", "0.20.0"]);
    expect(result.version).toBe("0.20.0");
    const order = ["0.20.0", "0.19.16", "0.19.15"].map((v) => result.source.indexOf(`version: "${v}"`));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(result.source).toContain('title: "Second",\n    notes: [\n      "Two",\n      "Three",\n    ],');
    expect(result.source).toContain('"Say \\"hi\\""');
  });

  it("fails when the list isn't there", () => {
    expect(() => applyNotes("0.19.15", "nothing", [], "2026-10-20")).toThrow("PATCH_NOTES");
  });
});

describe("pull requests and tags, for Tavora Admin", () => {
  it("reads a tags line before the title, and refuses odd tags", () => {
    expect(parseChangeNote("bump: minor\ntags: Cloud-Copy, recovery-key\n# Title\n- A note", "x.md").note).toMatchObject({ bump: "minor", tags: ["cloud-copy", "recovery-key"] });
    expect(parseChangeNote("# Title\n- A note", "x.md").note?.tags).toEqual([]);
    expect(parseChangeNote("tags: cloud copy\n# Title\n- A note", "x.md").problems[0]).toContain('"cloud copy"');
  });

  it("writes the pull requests and the tags into the entry, and leaves them out when there are none", () => {
    const entry = renderEntry({ version: "0.21.37", date: "2026-10-27", title: "T", notes: ["N"], prs: [{ number: 394, title: 'Icons "open"' }], tags: ["icons", "service"] });
    expect(entry).toContain('    prs: [\n      { number: 394, title: "Icons \\"open\\"" },\n    ],\n    tags: ["icons", "service"],\n  },');
    expect(renderEntry({ version: "0.21.37", date: "2026-10-27", title: "T", notes: ["N"] })).not.toMatch(/prs:|tags:/);
  });

  it("tags by the files a pull request changed, * within a folder and ** across them", () => {
    const rules = [
      { tag: "overlays", paths: ["apps/desktop/src/main/*overlay*"] },
      { tag: "system-monitor", paths: ["modules/system-monitor/**"] },
      { tag: "service", paths: ["apps/api/src/**"] },
    ];
    expect(tagsForFiles(["apps/desktop/src/main/game-overlays.ts", "modules/system-monitor/src/deep/App.vue"], rules)).toEqual(["overlays", "system-monitor"]);
    expect(tagsForFiles(["apps/desktop/src/main/sub/overlays.ts", "README.md"], rules)).toEqual([]);
    expect(mergeTags(["service", "accounts"], ["accounts"])).toEqual(["accounts", "service"]);
  });

  it("has rules for real paths, each tag once, in the shape the script reads", () => {
    const { tags } = JSON.parse(readFileSync(new URL("./change-tags.json", import.meta.url), "utf8")) as { tags: { tag: string; paths: string[] }[] };
    expect(new Set(tags.map((rule) => rule.tag)).size).toBe(tags.length);
    for (const rule of tags) {
      expect(rule.tag).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(rule.paths.length).toBeGreaterThan(0);
    }
    expect(tagsForFiles(["apps/desktop/src/main/cloud-copy.ts"], tags)).toContain("cloud-copy");
  });

  it("finds the pull request in GitHub's merge message or a squash", () => {
    expect(pullRequestOf("Merge pull request #391 from wellbrained/claude/admin-accounts", "\nTavora Admin: account list\n")).toEqual({ number: 391, title: "Tavora Admin: account list" });
    expect(pullRequestOf("Suspended accounts (#390)", "")).toEqual({ number: 390, title: "Suspended accounts" });
    expect(pullRequestOf("0.21.36: Suspended accounts", "")).toBeNull();
  });
});

describe("today", () => {
  it("is the date in Germany", () => {
    expect(today(new Date("2026-10-20T22:30:00Z"))).toBe("2026-10-21");
  });
});

describe("collectPullRequest", () => {
  /** A throwaway repo shaped like Tavora's: both package.json files and apps/desktop/changes. */
  function repo() {
    const dir = mkdtempSync(path.join(tmpdir(), "change-notes-"));
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd: dir, encoding: "utf8" }).trim();
    const write = (file: string, text: string) => {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      writeFileSync(path.join(dir, file), text);
    };
    const version = (v: string) => {
      write("package.json", JSON.stringify({ version: v }));
      write("apps/desktop/package.json", JSON.stringify({ version: v }));
    };
    const commit = (message: string) => {
      git("add", "-A");
      git("commit", "-q", "-m", message);
      return git("rev-parse", "HEAD");
    };
    git("init", "-q", "-b", "main");
    return { git, write, version, commit };
  }
  const note = (title: string, bump = "") => `${bump ? `bump: ${bump}\n` : ""}# ${title}\n\n- Something users see.\n`;

  it("reads only the notes this pull request adds, not the ones waiting on main", () => {
    const { git, write, version, commit } = repo();
    version("0.5.0");
    commit("start");
    git("switch", "-q", "-c", "feature");
    write("apps/desktop/changes/mine.md", note("Mine"));
    const head = commit("pr");
    git("switch", "-q", "main");
    // A stuck Number run: main holds a note that raises the minor number, and an invalid one.
    write("apps/desktop/changes/stuck.md", note("Stuck", "minor"));
    write("apps/desktop/changes/broken.md", "not a note\n");
    commit("main moves");
    const result = collectPullRequest(git, "main", head);
    expect(result.problems).toEqual([]);
    expect(result.notes.map((n: { file: string }) => n.file)).toEqual(["mine.md"]);
    expect(checkPullRequest({ ...result, featureComplete: false })).toEqual([]);
  });

  it("compares the version with where the branch left main, not with main's newer one", () => {
    const { git, write, version, commit } = repo();
    version("0.5.0");
    commit("start");
    git("switch", "-q", "-c", "feature");
    write("a.txt", "x");
    const head = commit("pr");
    git("switch", "-q", "main");
    version("0.5.1");
    commit("0.5.1: numbered");
    const result = collectPullRequest(git, "main", head);
    expect([result.base, result.head, result.rootHead]).toEqual(["0.5.0", "0.5.0", "0.5.0"]);
    expect(checkPullRequest({ ...result, featureComplete: false })).toEqual([]);
  });

  it("still catches a version raised by hand, a bad note, and the label rules", () => {
    const { git, write, version, commit } = repo();
    version("0.5.0");
    commit("start");
    git("switch", "-q", "-c", "feature");
    version("0.5.1");
    write("apps/desktop/changes/mine.md", note("Mine", "minor"));
    write("apps/desktop/changes/bad.md", "nope\n");
    const head = commit("pr");
    const result = collectPullRequest(git, "main", head);
    expect(result.problems.length).toBeGreaterThan(0);
    expect(result.head).toBe("0.5.1");
    const problems = checkPullRequest({ ...result, featureComplete: false });
    expect(problems.some((p: string) => p.includes("app version changes"))).toBe(true);
    expect(problems.some((p: string) => p.includes("bump: minor"))).toBe(true);
  });

  it("counts a note moved in from elsewhere as added, so it can't skip the label rule", () => {
    const { git, write, version, commit } = repo();
    version("0.5.0");
    write("docs/idea.md", note("A long enough title for git to call this a rename", "major"));
    commit("start");
    git("switch", "-q", "-c", "feature");
    mkdirSync(path.join(git("rev-parse", "--show-toplevel"), "apps/desktop/changes"), { recursive: true });
    git("mv", "docs/idea.md", "apps/desktop/changes/idea.md");
    const head = commit("pr");
    const result = collectPullRequest(git, "main", head);
    expect(result.notes.map((n: { file: string }) => n.file)).toEqual(["idea.md"]);
    expect(checkPullRequest({ ...result, featureComplete: false }).some((p: string) => p.includes("bump: major"))).toBe(true);
  });

  describe("the 1.0.0 fold", () => {
    const patchNotes = (...versions: string[]) => `export const PATCH_NOTES = [\n${versions.map((v) => `  {\n    version: "${v}",\n  },\n`).join("")}];\n`;
    function foldedTo(...left: string[]) {
      const { git, write, version, commit } = repo();
      version("1.0.1");
      write("apps/desktop/src/shared/patch-notes.ts", patchNotes("1.0.1", "1.0.0"));
      commit("start");
      git("switch", "-q", "-c", "fold");
      version("1.0.0");
      write("apps/desktop/src/shared/patch-notes.ts", patchNotes(...left));
      return collectPullRequest(git, "main", commit("fold"));
    }

    it("lets the version go back to 1.0.0 when only the 1.0.0 entry is left", () => {
      const result = foldedTo("1.0.0");
      expect(result.foldedBack).toBe(true);
      expect(checkPullRequest({ ...result, featureComplete: false })).toEqual([]);
    });

    it("refuses the step back while other entries are still there", () => {
      const result = foldedTo("1.0.0", "0.24.112");
      expect(result.foldedBack).toBe(false);
      expect(checkPullRequest({ ...result, featureComplete: false }).some((p: string) => p.includes("app version changes"))).toBe(true);
    });
  });
});
