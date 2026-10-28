import type { SystemApp } from "@tavora/sdk";
import { describe, expect, it } from "vitest";
import { firstDirection, listApps, ramShare, ramSplit, shownBytes, splitApps } from "./apps";

const app = (name: string, memoryBytes: number, cpu: number | null = 0): SystemApp => ({ name, memoryBytes, cpu, windows: false });
const APPS = [app("Firefox", 6.8e9, 2), app("Discord", 0.6e9, 0.1), app("Chrome", 1.9e9, 7.5), app("Svchost", 0.25e9, null)];
const names = (list: SystemApp[]) => list.map((entry) => entry.name);

describe("listApps", () => {
  it("sorts by RAM, CPU or name", () => {
    expect(names(listApps(APPS, "", "memory", "down"))).toEqual(["Firefox", "Chrome", "Discord", "Svchost"]);
    expect(names(listApps(APPS, "", "cpu", "down"))).toEqual(["Chrome", "Firefox", "Discord", "Svchost"]);
    expect(names(listApps(APPS, "", "name", "up"))).toEqual(["Chrome", "Discord", "Firefox", "Svchost"]);
    expect(names(listApps(APPS, "", "memory", "up"))).toEqual(["Svchost", "Discord", "Chrome", "Firefox"]);
  });

  it("finds apps by part of the name, in any case", () => {
    expect(names(listApps(APPS, " fIRe ", "memory", "down"))).toEqual(["Firefox"]);
    expect(listApps(APPS, "zzz", "memory", "down")).toEqual([]);
  });

  it("keeps equal numbers in name order", () => {
    expect(names(listApps([app("B", 1), app("a", 1)], "", "memory", "down"))).toEqual(["a", "B"]);
  });

  it("does not change the list it got", () => {
    const copy = [...APPS];
    listApps(APPS, "", "name", "up");
    expect(APPS).toEqual(copy);
  });
});

it("starts numbers with the biggest and names from A", () => {
  expect(firstDirection("memory")).toBe("down");
  expect(firstDirection("cpu")).toBe("down");
  expect(firstDirection("name")).toBe("up");
});

it("adds up what the list shows", () => {
  expect(shownBytes([app("A", 1e9), app("B", 2e9)])).toBe(3e9);
});

describe("ramSplit", () => {
  const GB = 1024 ** 3;
  it("rounds to whole GB from 10 GB in use, so apps + rest = in use on screen", () => {
    // 19.4 + 8.4 = 27.8: rounded on their own this would read 19 + 8 = 28.
    expect(ramSplit(19.4 * GB, 27.8 * GB)).toEqual({ apps: 19, rest: 9, used: 28, decimals: 0 });
  });

  it("uses tenths under 10 GB in use", () => {
    expect(ramSplit(5.04 * GB, 7.26 * GB)).toEqual({ apps: 5, rest: 2.3, used: 7.3, decimals: 1 });
  });

  it("never shows a rest below zero", () => {
    expect(ramSplit(30 * GB, 28 * GB)).toEqual({ apps: 28, rest: 0, used: 28, decimals: 0 });
  });
});

describe("splitApps", () => {
  const total = 32e9;
  it("folds away apps under 5 % of the installed RAM, keeping the order", () => {
    const { big, small } = splitApps(listApps(APPS, "", "memory", "down"), total, "");
    expect(names(big)).toEqual(["Firefox", "Chrome"]);
    expect(names(small)).toEqual(["Discord", "Svchost"]);
  });

  it("counts exactly 5 % as big", () => {
    expect(names(splitApps([app("Edge", 1.6e9)], total, "").big)).toEqual(["Edge"]);
  });

  it("shows every match of a search at once", () => {
    expect(splitApps(listApps(APPS, "disc", "memory", "down"), total, "disc")).toEqual({ big: [APPS[1]], small: [] });
  });

  it("folds nothing when the RAM size is unknown", () => {
    expect(splitApps(APPS, 0, "").small).toEqual([]);
  });
});

it("works out the share of the installed RAM", () => {
  expect(ramShare(1.6e9, 32e9)).toBe(5);
  expect(ramShare(1e9, 0)).toBeNull();
});

it("sorts % RAM like RAM", () => {
  expect(names(listApps(APPS, "", "share", "down"))).toEqual(names(listApps(APPS, "", "memory", "down")));
  expect(firstDirection("share")).toBe("down");
});
