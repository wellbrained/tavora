import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// host.ts can't be loaded in a unit test, so the pieces its safety rests on live in modules of their own, each with its
// own tests. This holds host.ts to calling them where it must: take a call away and the guarantee goes, so this fails.
const host = readFileSync(path.join(import.meta.dirname, "host.ts"), "utf8").replace(/\r\n/g, "\n");

/** The body of `name: (...) => { ... }` or `private [async] name(...) { ... }`, up to its closing brace at that indent. */
function body(start: RegExp): string {
  const match = start.exec(host);
  expect(match, String(start)).not.toBeNull();
  const indent = /^( *)/m.exec(host.slice(host.lastIndexOf("\n", match!.index) + 1))![1]!;
  const end = host.indexOf(`\n${indent}}`, match!.index);
  return host.slice(match!.index, end);
}

describe("host.ts", () => {
  it("ends open OBS pages when grants change and whenever modules are looked for again", () => {
    expect(body(/grantsChanged: \(\) => \{/)).toContain("this.streaming?.recheckStreams()");
    expect(body(/private async reloadModules\(\)/)).toContain("this.streaming?.recheckStreams()");
  });

  it("deletes a refused update's installer", () => {
    expect(host).toMatch(/onRefused: \(info\) => removeRefusedInstaller\(info, app\.isPackaged\)/);
  });

  it("forgets a saved official key that is no longer trusted, and publishes built-in modules only from a development build", () => {
    expect(host).toMatch(/await loadTrustedSavedKey\(this\.officialKeys,/);
    expect(host).toMatch(/if \(!officialPublishAllowed\(app\.isPackaged, officialOn\(OFFICIAL_PINS\)\)\) return null;/);
  });
});
