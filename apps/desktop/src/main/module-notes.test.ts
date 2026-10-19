import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { validateChangelog } from "@tavora/module-schema";
import { describe, expect, it } from "vitest";
import { hasUnseenNotes, installedNotes } from "./module-notes";

const entries = [
  { version: "1.2.0", notes: ["Next."] },
  { version: "1.0.0", notes: ["First."] },
  { version: "1.1.0", notes: ["Middle."] },
];

describe("module patch notes", () => {
  it("shows the installed version and older, newest first", () => {
    expect(installedNotes(entries, "1.1.0").map((entry) => entry.version)).toEqual(["1.1.0", "1.0.0"]);
  });

  it("marks notes new only after an update past the version the player saw", () => {
    expect(hasUnseenNotes(entries, "1.1.0", "1.0.0")).toBe(true);
    expect(hasUnseenNotes(entries, "1.1.0", "1.1.0")).toBe(false);
    // Never seen: a fresh install starts read, so nothing is new.
    expect(hasUnseenNotes(entries, "1.1.0", undefined)).toBe(false);
    // Notes for a version not installed yet are not new.
    expect(hasUnseenNotes(entries, "1.0.0", "1.0.0")).toBe(false);
  });
});

describe("Tavora's own modules", () => {
  const root = path.resolve(__dirname, "../../../../modules");
  const official = readdirSync(root).filter((name) => {
    try {
      readFileSync(path.join(root, name, "tavora.module.json"));
      return true;
    } catch {
      return false;
    }
  });

  it.each(official)("%s has patch notes for its version", (name) => {
    const manifest = JSON.parse(readFileSync(path.join(root, name, "tavora.module.json"), "utf8"));
    expect(manifest.changelog).toBe("changelog.json");
    const result = validateChangelog(JSON.parse(readFileSync(path.join(root, name, manifest.changelog), "utf8")));
    expect(result.ok && result.entries[0]?.version).toBe(manifest.version);
  });
});
