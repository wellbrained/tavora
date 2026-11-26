import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CHANGELOG_LIMITS, validateChangelog } from "../packages/module-schema/src/index.js";
import { describe, expect, it } from "vitest";
// @ts-expect-error - plain JavaScript module run by .github/workflows/number.yml
import { KEEP, trimAll, trimmed } from "./trim-changelogs.mjs";

/** A changelog of `count` versions, newest first, as the repo writes them. */
const changelog = (count: number, newest = count) =>
  `${JSON.stringify(Array.from({ length: count }, (_, index) => ({ version: `0.1.${newest - index}`, notes: ["x"] })), null, 2)}\n`;

describe("trim-changelogs", () => {
  it("leaves room under the limit the app and the catalogue enforce", () => {
    expect(KEEP).toBeLessThan(CHANGELOG_LIMITS.maxEntries);
    const result = validateChangelog(JSON.parse(trimmed(changelog(CHANGELOG_LIMITS.maxEntries))));
    expect(result.ok && result.entries.length).toBe(KEEP);
  });

  it("keeps the newest versions and the file's line endings, and leaves a short changelog alone", () => {
    expect(trimmed(changelog(KEEP + 5))).toBe(changelog(KEEP, KEEP + 5));
    expect(trimmed(changelog(KEEP + 5).replaceAll("\n", "\r\n"))).toBe(changelog(KEEP, KEEP + 5).replaceAll("\n", "\r\n"));
    expect(trimmed(changelog(KEEP))).toBeNull();
  });

  it("changes only the modules that need it", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "trim-"));
    for (const [name, count] of [["long", KEEP + 5], ["short", 3]] as const) {
      mkdirSync(path.join(root, "modules", name), { recursive: true });
      writeFileSync(path.join(root, "modules", name, "changelog.json"), changelog(count));
    }
    mkdirSync(path.join(root, "modules", "shared"));
    // A broken one is left alone and doesn't stop the others.
    mkdirSync(path.join(root, "modules", "broken"));
    writeFileSync(path.join(root, "modules", "broken", "changelog.json"), "{ nope");
    expect(trimAll(root)).toEqual(["long"]);
    expect(JSON.parse(readFileSync(path.join(root, "modules", "long", "changelog.json"), "utf8"))).toHaveLength(KEEP);
    expect(trimAll(root)).toEqual([]);
  });
});
