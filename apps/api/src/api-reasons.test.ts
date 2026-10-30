import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { API_REASONS } from "@tavora/module-schema";

/**
 * Every refusal code the API sends is listed in API_REASONS (packages/module-schema), which the desktop app
 * and tavora-pack read. This test finds the codes by reading the source, so a new or renamed code in the API
 * fails here until the list follows, and a code nobody sends any more fails too.
 *
 * What counts as a code the API sends:
 * - `reason: "x"` in an answer or in a result that becomes one (name changes, cloud copy, rejected leaderboard results),
 * - the third argument of the refusal helpers `fail`, `refuse` and `steamFail`, and of `bad` when it has one,
 * - the codes of SteamError and DiscordError, and the SUBMIT_REASONS table.
 * Reasons the clients type in (report, ban, suspend and unpublish reasons) are values, never literals here.
 */
function sentReasons(): string[] {
  const dir = new URL(".", import.meta.url);
  const found = new Set<string>();
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
    const text = readFileSync(new URL(name, dir), "utf8");
    for (const match of text.matchAll(/\breason: "([a-z-]+)"/g)) found.add(match[1]!);
    for (const match of text.matchAll(/\b(?:fail|refuse|steamFail)\(context, [^,]+, "([a-z-]+)"/g)) found.add(match[1]!);
    for (const match of text.matchAll(/\bbad\(context, .*, "([a-z-]+)"\)/g)) found.add(match[1]!);
    for (const match of text.matchAll(/new (?:SteamError\(\d+,|DiscordError\()\s*"([a-z-]+)"/g)) found.add(match[1]!);
    for (const line of text.match(/^const SUBMIT_REASONS = .*$/m) ?? []) for (const match of line.matchAll(/\d+: "([a-z-]+)"/g)) found.add(match[1]!);
  }
  return [...found].sort();
}

describe("API_REASONS", () => {
  const sent = sentReasons();
  const listed: readonly string[] = API_REASONS;

  it("lists every reason the API sends", () => {
    expect(sent.filter((reason) => !listed.includes(reason))).toEqual([]);
  });

  it("lists nothing the API does not send", () => {
    expect(listed.filter((reason) => !sent.includes(reason))).toEqual([]);
  });

  it("lists each reason once", () => {
    expect(new Set(listed).size).toBe(listed.length);
  });
});
