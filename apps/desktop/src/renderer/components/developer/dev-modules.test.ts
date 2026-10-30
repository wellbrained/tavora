import { describe, expect, it } from "vitest";
import type { HostViewState } from "../../../shared/host-api";
import { devModules, waitsForPublish } from "./dev-modules";

type Module = HostViewState["modules"][number];
type Folder = HostViewState["developmentFolders"][number];

const module = (id: string, version = "1.0.0") => ({ id, name: id.split(".")[1]!, version, origin: { kind: "dev", folder: "x" } }) as unknown as Module;
const folder = (projects: [string, string][]) => ({ folder: "f", projects: projects.map(([moduleId, project]) => ({ moduleId, project })) }) as unknown as Folder;

describe("devModules", () => {
  it("joins a Local and a Release copy into one module, published from the Release copy", () => {
    const modules = [module("local.timer", "1.1.0"), module("wellbrained.timer", "1.0.0")];
    const [entry] = devModules([folder([["local.timer", "/dev/timer"]]), folder([["wellbrained.timer", "/releases/timer"]])], modules, { "wellbrained.timer": "new-version" });
    expect(entry).toMatchObject({ key: "timer", local: { project: "/dev/timer" }, release: { project: "/releases/timer" }, status: "new-version" });
    expect(entry!.publishes.module.id).toBe("wellbrained.timer");
    expect(waitsForPublish(entry!)).toBe(true);
  });

  it("keeps a module with one copy as that copy, and knows no status for a local one", () => {
    const entries = devModules([folder([["local.notes", "/dev/notes"], ["wellbrained.map", "/dev/map"]])], [module("local.notes"), module("wellbrained.map")], { "wellbrained.map": "current" });
    expect(entries.map((entry) => [entry.key, entry.local?.project ?? null, entry.release?.project ?? null, entry.status])).toEqual([
      ["map", null, "/dev/map", "current"],
      ["notes", "/dev/notes", null, null],
    ]);
  });
});
