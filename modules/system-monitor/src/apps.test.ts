import type { SystemApp } from "@tavora/sdk";
import { describe, expect, it } from "vitest";
import { firstDirection, listApps, shownBytes } from "./apps";

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
