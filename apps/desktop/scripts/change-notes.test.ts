import { describe, expect, it } from "vitest";
// @ts-expect-error - plain JavaScript module run by .github/workflows/version.yml and number.yml
import { applyNotes, checkPullRequest, nextVersion, parseChangeNote, today } from "./change-notes.mjs";

describe("parseChangeNote", () => {
  it("reads a title and notes, and raises the patch number by default", () => {
    const { note, problems } = parseChangeNote("# Lost a key?\n\n- Press Lost it?\n- Your modules move\n  to your newest key.\n", "a.md");
    expect(problems).toEqual([]);
    expect(note).toEqual({ bump: "patch", title: "Lost a key?", notes: ["Press Lost it?", "Your modules move to your newest key."] });
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

describe("today", () => {
  it("is the date in Germany", () => {
    expect(today(new Date("2026-10-20T22:30:00Z"))).toBe("2026-10-21");
  });
});
