import { describe, expect, it } from "vitest";
import { readReleaseNotes } from "../src/main/updates";
// @ts-expect-error - plain JavaScript module run by pnpm build
import { releaseNotesFor } from "./release-notes.mjs";

const entries = [
  { version: "0.24.0", date: "2026-11-04", title: "Updates", notes: ["Updates show their progress.", "Checks every hour."] },
  { version: "0.23.99", date: "2026-11-03", title: "Rows", notes: ["Rows are tinted."] },
];

describe("release notes for the update feed", () => {
  it("writes the version's notes as a list, one change per line", () => {
    expect(releaseNotesFor(entries, "0.24.0")).toBe("- Updates show their progress.\n- Checks every hour.\n");
  });

  it("writes nothing for a version without an entry", () => {
    expect(releaseNotesFor(entries, "0.25.0")).toBe("");
  });

  it("reads back as the same lines in the app", () => {
    expect(readReleaseNotes(releaseNotesFor(entries, "0.24.0"))).toEqual(["Updates show their progress.", "Checks every hour."]);
  });
});
