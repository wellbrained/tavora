import { describe, expect, it } from "vitest";
import type { CatalogEntry } from "./catalog-client";
import { isReleaseCopies, releaseStatus, releaseStatuses } from "./release-pending";

const listed = (id: string, version: string) => ({ id, version }) as CatalogEntry;

describe("releaseStatus", () => {
  it("is a new version when the copy is newer", () => {
    expect(releaseStatus("0.2.0", "0.1.9")).toBe("new-version");
    expect(releaseStatus("0.1.0-alpha.13", "0.1.0-alpha.12")).toBe("new-version");
    expect(releaseStatus("0.1.0", "0.1.0-alpha.13")).toBe("new-version");
  });

  it("is current when the catalog has the same or a newer version", () => {
    expect(releaseStatus("0.1.0", "0.1.0")).toBe("current");
    expect(releaseStatus("0.1.0-alpha.12", "0.1.0-alpha.13")).toBe("current");
    expect(releaseStatus("0.1.0-alpha.13", "0.1.0")).toBe("current");
    expect(releaseStatus("0.1.0", "0.2.0")).toBe("current");
  });

  it("is not published when the catalog has no such module", () => {
    expect(releaseStatus("0.1.0", null)).toBe("not-published");
  });
});

describe("releaseStatuses", () => {
  it("compares each copy with its listing", () => {
    const index = [listed("wellbrained.a", "1.0.0"), listed("wellbrained.b", "1.0.0"), listed("wellbrained.other", "9.0.0")];
    const copies = [
      { id: "wellbrained.a", version: "1.0.1" },
      { id: "wellbrained.b", version: "1.0.0" },
      { id: "wellbrained.c", version: "0.1.0" },
    ];
    expect(releaseStatuses(index, copies)).toEqual({ "wellbrained.a": "new-version", "wellbrained.b": "current", "wellbrained.c": "not-published" });
  });

  it("is unknown, not a guess, when the catalog could not be reached", () => {
    expect(releaseStatuses(null, [{ id: "wellbrained.a", version: "1.0.0" }])).toBeNull();
  });

  it("answers an empty catalog with every copy not published", () => {
    expect(releaseStatuses([], [{ id: "wellbrained.a", version: "1.0.0" }])).toEqual({ "wellbrained.a": "not-published" });
  });
});

describe("isReleaseCopies", () => {
  it("accepts ids with versions and nothing else", () => {
    expect(isReleaseCopies([{ id: "wellbrained.a", version: "0.1.0-alpha.13" }])).toBe(true);
    expect(isReleaseCopies([])).toBe(true);
    expect(isReleaseCopies("wellbrained.a")).toBe(false);
    expect(isReleaseCopies([{ id: "wellbrained.a" }])).toBe(false);
    expect(isReleaseCopies([{ id: "wellbrained.a", version: "latest" }])).toBe(false);
    expect(isReleaseCopies([null])).toBe(false);
  });
});
