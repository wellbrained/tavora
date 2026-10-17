import { readFileSync } from "node:fs";
import { MIN_TAVORA, SDK_VERSION } from "@tavora/sdk";
import { describe, expect, it } from "vitest";
import { PATCH_NOTES } from "../shared/patch-notes";

const SEMVER = /^\d+\.\d+\.\d+$/;
const parts = (version: string) => version.split(".").map(Number) as [number, number, number];

describe("app version", () => {
  const { version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };

  it("is major.minor.patch and has left 0.0.0, the version before releases were numbered", () => {
    expect(version).toMatch(SEMVER);
    expect(version).not.toBe("0.0.0");
  });

  it("has patch notes for the version the app is on, newest first", () => {
    expect(PATCH_NOTES[0]!.version).toBe(version);
  });

  it("is also the repository's version (tools read the root package.json), so a bump changes both", () => {
    const root = JSON.parse(readFileSync(new URL("../../../../package.json", import.meta.url), "utf8")) as { version?: string };
    expect(root.version).toBe(version);
  });
});

describe("SDK version", () => {
  it("is the version in its package.json, and its changelog has an entry for it", () => {
    const sdk = new URL("../../../../packages/sdk/", import.meta.url);
    const { version } = JSON.parse(readFileSync(new URL("package.json", sdk), "utf8")) as { version: string };
    expect(SDK_VERSION).toBe(version);
    expect(readFileSync(new URL("CHANGELOG.md", sdk), "utf8").split(/\r?\n/)).toContain(`## ${version}`);
  });

  it("needs the Tavora its newest changelog entry names, which is never newer than this app", () => {
    const changelog = readFileSync(new URL("../../../../packages/sdk/CHANGELOG.md", import.meta.url), "utf8");
    const newest = changelog.split(/^## /m)[1] ?? "";
    const named = [...newest.matchAll(/\(Tavora (\d+\.\d+\.\d+)\)/g)].map((match) => parts(match[1]!));
    const highest = named.sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2])[0];
    expect(highest?.join(".")).toBe(MIN_TAVORA);
    const app = parts((JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version);
    const need = parts(MIN_TAVORA);
    expect(app[0] - need[0] || app[1] - need[1] || app[2] - need[2]).toBeGreaterThanOrEqual(0);
  });
});

describe("patch notes", () => {
  it("lists each version once, newest first, with a date, a title and notes", () => {
    const versions = PATCH_NOTES.map((entry) => entry.version);
    expect(new Set(versions).size).toBe(versions.length);
    for (const entry of PATCH_NOTES) {
      expect(entry.version).toMatch(SEMVER);
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.title.trim()).not.toBe("");
      expect(entry.notes.length).toBeGreaterThan(0);
      expect(entry.notes.every((note) => note.trim() !== "")).toBe(true);
    }
    for (let i = 1; i < PATCH_NOTES.length; i++) {
      const [a, b] = [parts(PATCH_NOTES[i - 1]!.version), parts(PATCH_NOTES[i]!.version)];
      expect(a[0] - b[0] || a[1] - b[1] || a[2] - b[2]).toBeGreaterThan(0);
    }
  });
});
