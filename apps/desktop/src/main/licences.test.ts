import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { legalPageUrl } from "../shared/legal-links";
import { readLicences } from "./licences";

function fileWith(content: string): string {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "licences-")), "licences.json");
  writeFileSync(file, content);
  return file;
}

describe("readLicences", () => {
  it("reads what the build writes", () => {
    const data = { entries: [{ name: "vue", version: "3", license: "MIT", group: "libraries", texts: [0] }], texts: ["MIT text"] };
    expect(readLicences(fileWith(JSON.stringify(data)))).toEqual(data);
  });

  it("gives null for a missing file, bad JSON, or a shape it doesn't know", () => {
    expect(readLicences(path.join(tmpdir(), "nope-licences.json"))).toBeNull();
    expect(readLicences(fileWith("{"))).toBeNull();
    expect(readLicences(fileWith(JSON.stringify({ entries: "x", texts: [] })))).toBeNull();
    expect(readLicences(fileWith(JSON.stringify({ entries: [{ name: "a", version: "1", license: "MIT", group: "libraries", texts: [3] }], texts: ["t"] })))).toBeNull();
    expect(readLicences(fileWith(JSON.stringify({ entries: [{ name: "a", version: "1", license: "MIT", group: "other", texts: [0] }], texts: ["t"] })))).toBeNull();
  });
});

describe("legalPageUrl", () => {
  it("points at the English page, or the German one under /de/", () => {
    expect(legalPageUrl("privacy", "en")).toBe("https://mytavora.app/privacy/");
    expect(legalPageUrl("terms", "de")).toBe("https://mytavora.app/terms/de/");
    expect(legalPageUrl("imprint", "de")).toBe("https://mytavora.app/imprint/de/");
  });
});
