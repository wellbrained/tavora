import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { panelTypes, validateManifest } from "./index";

// Clock & Counter (modules/clock-counter) is an official module that may be shown over the game. These are the parts of
// its manifest that make it so; the rest of the manifest is checked like any other.

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../../modules/clock-counter/${name}`, import.meta.url), "utf8")) as Record<string, unknown>;

describe("Clock & Counter's manifest", () => {
  const manifest = read("tavora.module.json");

  it("is a valid manifest", () => {
    expect(validateManifest(manifest)).toMatchObject({ ok: true });
  });

  it("can be shown over the game, with the page its live view needs", () => {
    // Without `inGame` the Overlay page lists the panel under "Can't be used here"; without `overlay` the panel shows nothing while the game layer is closed.
    expect(manifest.inGame).toBe(true);
    expect(manifest.overlay).toBe("dist/overlay.html");
    // A module without panel types: the manifest's own `inGame` is the one that counts.
    expect(panelTypes(manifest as never)).toEqual([]);
  });

  it("names its newest version first in the changelog", () => {
    const changelog = read("changelog.json") as unknown as { version: string }[];
    expect(changelog[0]!.version).toBe(manifest.version);
  });
});
