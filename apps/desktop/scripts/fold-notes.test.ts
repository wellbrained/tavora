import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PATCH_NOTES } from "../src/shared/patch-notes";
// @ts-expect-error - plain JavaScript module run by pnpm release:fold
import { foldEntries, foldText, formatEntry, unreleased } from "./fold-notes.mjs";

const entries = [
  { version: "0.4.2", date: "2026-10-31", title: "Newest", notes: ["C"], prs: [{ number: 12, title: "C pr" }], tags: ["b", "a"] },
  { version: "0.4.1", date: "2026-10-30", title: "Middle", notes: ["B1", "B2"], prs: [{ number: 11, title: "B pr" }, { number: 9, title: "A pr" }], tags: ["c", "a"] },
  { version: "0.4.0", date: "2026-10-29", title: "Released", notes: ["A"], prs: [{ number: 9, title: "A pr" }] },
];

const text = `export const PATCH_NOTES = [\r\n${entries.map((entry) => formatEntry(entry, "\r\n")).join("")}];\r\n`;

describe("fold-notes", () => {
  it("folds only what came after the last release", () => {
    expect(unreleased(entries, "0.4.0").map((entry: { version: string }) => entry.version)).toEqual(["0.4.2", "0.4.1"]);
    expect(unreleased(entries, null)).toHaveLength(3);
  });

  it("keeps the newest version, date and title, every note, every pull request and every tag", () => {
    expect(foldEntries(entries.slice(0, 2))).toEqual({
      version: "0.4.2",
      date: "2026-10-31",
      title: "Newest",
      notes: ["C", "B1", "B2"],
      prs: [{ number: 12, title: "C pr" }, { number: 11, title: "B pr" }, { number: 9, title: "A pr" }],
      tags: ["a", "b", "c"],
    });
  });

  it("rewrites only the folded entries and keeps the file's line endings", () => {
    const result = foldText(text, entries, "0.4.0");
    expect(result.folded).toEqual(["0.4.1"]);
    expect(result.text).toBe(`export const PATCH_NOTES = [\r\n${formatEntry(foldEntries(entries.slice(0, 2)), "\r\n")}${formatEntry(entries[2]!, "\r\n")}];\r\n`);
  });

  it("folds up to the end of the list when nothing was released yet", () => {
    const result = foldText(text, entries, null);
    expect(result.text).toBe(`export const PATCH_NOTES = [\r\n${formatEntry(foldEntries(entries), "\r\n")}];\r\n`);
  });

  it("says when there is nothing to fold, which is not a problem", () => {
    const result = foldText(text, entries, "0.4.1");
    expect(result.nothing).toMatch(/only 0.4.2 is newer than 0.4.1/);
    expect(result.problem).toBeUndefined();
    expect(foldText(text, entries, "0.4.2").nothing).toMatch(/no entry is newer than 0.4.2/);
  });

  describe("the release with the catalog", () => {
    const major = { version: "1.0.0", date: "2026-11-15", title: "Tavora 1.0", notes: ["First public version."], prs: [{ number: 20, title: "D pr" }], tags: ["z"] };
    const all = [major, ...entries];
    const file = `export const PATCH_NOTES = [\n${all.map((entry) => formatEntry(entry)).join("")}];\n`;

    it("leaves only its own entry: own notes, every pull request and tag, nothing else", () => {
      const result = foldText(file, all, "0.4.0", "1.0.0");
      expect(result.folded).toEqual(["0.4.2", "0.4.1", "0.4.0"]);
      expect(result.text).toBe(
        `export const PATCH_NOTES = [\n${formatEntry({ ...major, prs: [{ number: 20, title: "D pr" }, { number: 12, title: "C pr" }, { number: 11, title: "B pr" }, { number: 9, title: "A pr" }], tags: ["a", "b", "c", "z"] })}];\n`,
      );
    });

    it("also drops entries from before the last release, and works when it is the only new entry", () => {
      const result = foldText(file, all, "0.4.2", "1.0.0");
      expect(result.text).not.toContain("0.4.");
      expect(result.text).toContain('version: "1.0.0"');
    });

    it("does nothing to the file twice, and not at all once 1.0.0 is released", () => {
      const once = foldText(file, all, "0.4.0", "1.0.0");
      const left = { ...major, prs: [{ number: 20, title: "D pr" }, { number: 12, title: "C pr" }, { number: 11, title: "B pr" }, { number: 9, title: "A pr" }], tags: ["a", "b", "c", "z"] };
      expect(foldText(once.text, [left], null, "1.0.0").nothing).toMatch(/only entry/);
      expect(foldText(once.text, [major], "1.0.0", "1.0.0").nothing).toMatch(/Nothing to fold/);
    });

    it("folds an entry that merged after 1.0.0 was numbered into it, and sends the version back to 1.0.0", () => {
      const newer = [{ version: "1.0.1", date: "2026-11-16", title: "Later", notes: ["L"], prs: [{ number: 21, title: "E pr" }], tags: ["y"] }, ...all];
      const text = `export const PATCH_NOTES = [\n${newer.map((entry) => formatEntry(entry)).join("")}];\n`;
      const result = foldText(text, newer, "0.4.0", "1.0.0");
      expect(result.problem).toBeUndefined();
      expect(result.setVersion).toBe("1.0.0");
      expect(result.folded).toEqual(["1.0.1", "0.4.2", "0.4.1", "0.4.0"]);
      const left = { ...major, notes: ["First public version.", "L"], prs: [{ number: 21, title: "E pr" }, { number: 20, title: "D pr" }, { number: 12, title: "C pr" }, { number: 11, title: "B pr" }, { number: 9, title: "A pr" }], tags: ["a", "b", "c", "y", "z"] };
      expect(result.text).toBe(`export const PATCH_NOTES = [\n${formatEntry(left)}];\n`);
      // Run again after the fold was merged: nothing more to do.
      expect(foldText(result.text, [left], null, "1.0.0").nothing).toMatch(/Nothing to fold/);
    });

    it("leaves the version alone when 1.0.0 is already the newest entry", () => {
      expect(foldText(file, all, "0.4.0", "1.0.0").setVersion).toBeUndefined();
    });

    // A rehearsal of release day on the real file, as long as it is still before 1.0.0. Once the 1.0.0 entry is
    // numbered (and after the fold), there is nothing left to rehearse, so it skips instead of failing main.
    it.skipIf(!PATCH_NOTES[0]!.version.startsWith("0."))("works on the real patch-notes.ts: one entry is left, the release guards are happy", () => {
      const real = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/shared/patch-notes.ts"), "utf8").replace(/\r\n/g, "\n");
      const top = { version: "1.0.0", date: "2026-11-15", title: "Tavora 1.0", notes: ["First public version."] };
      const start = "export const PATCH_NOTES: readonly PatchNote[] = [\n";
      const text = real.replace(start, start + formatEntry(top));
      const result = foldText(text, [top, ...PATCH_NOTES], PATCH_NOTES[0]!.version, "1.0.0");
      expect(result.problem).toBeUndefined();
      expect([...result.text.matchAll(/^ {4}version: "/gm)]).toHaveLength(1);
      expect(result.text.startsWith(real.slice(0, real.indexOf(start) + start.length))).toBe(true);
      expect(result.text.trimEnd().endsWith("];")).toBe(true);
    });

    it("leaves ordinary folds alone before 1.0.0", () => {
      expect(foldText(text, entries, "0.4.0", "1.0.0").folded).toEqual(["0.4.1"]);
    });
  });

  it("writes entries exactly as patch-notes.ts has them", () => {
    const file = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/shared/patch-notes.ts"), "utf8").replace(/\r\n/g, "\n");
    for (const entry of PATCH_NOTES.slice(0, 5)) expect(file).toContain(formatEntry(entry));
  });
});
