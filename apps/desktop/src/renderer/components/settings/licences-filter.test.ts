import { describe, expect, it } from "vitest";
import type { LicenceList } from "../../../shared/host-api";
import { filterLicences } from "./licences-filter";

const list: LicenceList = {
  texts: ["MIT text", "OFL text"],
  entries: [
    { name: "vue", version: "3.5.45", license: "MIT", group: "libraries", texts: [0] },
    { name: "@fontsource-variable/inter", version: "5.3.0", license: "OFL-1.1", group: "fonts", texts: [1] },
    { name: "serde", version: "1.0.229", license: "MIT OR Apache-2.0", group: "helper", texts: [0] },
  ],
};

describe("filterLicences", () => {
  it("groups everything in the page's order for an empty query", () => {
    expect(filterLicences(list, "  ").map((part) => [part.group, part.entries.length])).toEqual([["libraries", 1], ["fonts", 1], ["helper", 1]]);
  });

  it("matches every word against name, version and licence, in any case", () => {
    expect(filterLicences(list, "INTER ofl").flatMap((part) => part.entries.map((entry) => entry.name))).toEqual(["@fontsource-variable/inter"]);
    expect(filterLicences(list, "mit").flatMap((part) => part.entries.map((entry) => entry.name))).toEqual(["vue", "serde"]);
    expect(filterLicences(list, "3.5.45").flatMap((part) => part.entries.map((entry) => entry.name))).toEqual(["vue"]);
  });

  it("leaves out empty groups and finds nothing for a miss", () => {
    expect(filterLicences(list, "serde").map((part) => part.group)).toEqual(["helper"]);
    expect(filterLicences(list, "zzz")).toEqual([]);
  });
});
