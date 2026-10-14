import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { emptyWorkspace, fitsMinimums, layoutColumns, loadWorkspace, saveWorkspace } from "./workspace";

const area = { x: 0, y: 76, width: 1001, height: 600 };
const ID = "123e4567-e89b-42d3-a456-426614174000";

describe("layoutColumns", () => {
  it("splits the area into columns that cover it exactly", () => {
    const columns = layoutColumns(3, area);
    expect(columns.map((c) => c.width)).toEqual([333, 333, 335]);
    expect(columns.map((c) => c.x)).toEqual([0, 333, 666]);
    expect(columns.every((c) => c.y === 76 && c.height === 600)).toBe(true);
    expect(layoutColumns(0, area)).toEqual([]);
  });
});

describe("fitsMinimums", () => {
  it("checks every panel against its own minimum", () => {
    expect(fitsMinimums(area, [{ minWidth: 320, minHeight: 240 }, { minWidth: 320, minHeight: 240 }])).toBe(true);
    expect(fitsMinimums(area, [{ minWidth: 320, minHeight: 240 }, { minWidth: 600, minHeight: 240 }])).toBe(false);
    expect(fitsMinimums(area, [{ minWidth: 100, minHeight: 700 }])).toBe(false);
  });
});

describe("loadWorkspace", () => {
  it("returns an empty workspace when nothing is saved", async () => {
    const file = path.join(await mkdtemp(path.join(tmpdir(), "tavora-ws-")), "workspace.json");
    expect(await loadWorkspace(file, ["poe2", "satisfactory"], () => true)).toEqual({
      version: 1,
      games: { poe2: { instances: [] }, satisfactory: { instances: [] } },
    });
  });

  it("round-trips and drops unknown games, missing modules and bad records", async () => {
    const file = path.join(await mkdtemp(path.join(tmpdir(), "tavora-ws-")), "workspace.json");
    await saveWorkspace(file, {
      version: 1,
      games: {
        poe2: { instances: [{ instanceId: ID, moduleId: "local.example.a" }] },
        satisfactory: {
          instances: [
            { instanceId: ID, moduleId: "local.example.gone" },
            { instanceId: "../../x", moduleId: "local.example.a" },
          ],
        },
        removed: { instances: [{ instanceId: ID, moduleId: "local.example.a" }] },
      },
    });
    const state = await loadWorkspace(file, ["poe2", "satisfactory"], (id) => id === "local.example.a");
    expect(state.games).toEqual({
      poe2: { instances: [{ instanceId: ID, moduleId: "local.example.a" }] },
      satisfactory: { instances: [] },
    });
  });

  it("ignores an unreadable file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "tavora-ws-"));
    await writeFile(path.join(dir, "a.json"), "{oops");
    expect(await loadWorkspace(path.join(dir, "a.json"), ["poe2"], () => true)).toEqual(emptyWorkspace(["poe2"]));
  });
});
