import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error - plain JavaScript module run by .github/workflows/version.yml and number.yml
import { applyNotes, checkPullRequest, mergeTags, nextVersion, parseChangeNote, pullRequestOf, renderEntry, tagsForFiles, today } from "./change-notes.mjs";

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
