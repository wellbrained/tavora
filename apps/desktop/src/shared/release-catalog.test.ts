import { describe, expect, it } from "vitest";
import type { PatchNote } from "./patch-notes";
import { CATALOG_VERSION, RELEASE_CATALOG, visiblePatchNotes } from "./release-catalog";

const entry = (version: string): PatchNote => ({ version, date: "2026-11-15", title: `T ${version}`, notes: ["A"] });

describe("release catalog", () => {
  it("has English and German for every heading and line, in the same shape", () => {
    expect(RELEASE_CATALOG.length).toBeGreaterThan(0);
    const ids = RELEASE_CATALOG.map((group) => group.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const group of RELEASE_CATALOG) {
      expect(group.items.length, group.id).toBeGreaterThan(0);
      for (const text of [group.title, ...group.items]) {
        for (const language of ["en", "de"] as const) expect(text[language].trim(), `${group.id} ${language}`).not.toBe("");
      }
    }
  });

  it("keeps to the writing rules: short headings, one short sentence per line", () => {
    for (const group of RELEASE_CATALOG) {
      expect(group.title.en.split(/\s+/).length, group.title.en).toBeLessThanOrEqual(6);
      for (const item of group.items) {
        for (const language of ["en", "de"] as const) expect(item[language].length, item[language]).toBeLessThanOrEqual(110);
      }
    }
  });

  it("leaves out what 1.0 does not ship", () => {
    const text = JSON.stringify(RELEASE_CATALOG).toLowerCase();
    for (const word of ["linux", "macos", "mac os", "discord voice", "satisfactory", "enshrouded", "poe"]) expect(text, word).not.toContain(word);
  });
});

describe("visiblePatchNotes", () => {
  it("shows every entry, and no catalog, until the 1.0.0 entry is there", () => {
    const notes = [entry("0.24.61"), entry("0.24.60"), entry("0.24.59")];
    expect(visiblePatchNotes(notes)).toEqual({ entries: notes, catalog: null });
  });

  it("drops the entries before 1.0.0 and marks the 1.0.0 entry as the catalog", () => {
    const notes = [entry("1.0.1"), entry(CATALOG_VERSION), entry("0.24.60"), entry("0.9.0")];
    const shown = visiblePatchNotes(notes);
    expect(shown.entries.map((e) => e.version)).toEqual(["1.0.1", "1.0.0"]);
    expect(shown.catalog).toBe(notes[1]);
  });

  it("starts the fresh changelog above the catalog", () => {
    const notes = [entry("2.0.0"), entry("1.2.10"), entry("1.0.0")];
    expect(visiblePatchNotes(notes).entries).toHaveLength(3);
    expect(visiblePatchNotes([entry("1.0.0")]).entries).toHaveLength(1);
  });
});
