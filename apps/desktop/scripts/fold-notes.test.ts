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

  it("writes entries exactly as patch-notes.ts has them", () => {
    const file = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/shared/patch-notes.ts"), "utf8").replace(/\r\n/g, "\n");
    for (const entry of PATCH_NOTES.slice(0, 5)) expect(file).toContain(formatEntry(entry));
  });
});
