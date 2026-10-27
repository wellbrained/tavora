import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { movedModule, MOVED_MODULES_OWNER, moveOfficialModules } from "./moved-modules";

const OWNER = MOVED_MODULES_OWNER;

async function put(file: string, text: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}

describe("Discord and AI Usage leaving Tavora", () => {
  it("hand what they saved to their catalog modules", async () => {
    const userData = await mkdtemp(path.join(tmpdir(), "tavora-moved-"));
    const data = path.join(userData, "module-data");
    const files = path.join(userData, "module-files");
    await put(path.join(data, "official", "tavora.discord", "_app", "settings.json"), '{"last":1}');
    await put(path.join(data, "official", "tavora.discord", "valheim", "settings.json"), '{"server":1}');
    await put(path.join(data, "official", "tavora.ai-usage", "_app", "settings.json"), '{"order":[]}');
    await put(path.join(data, "official", "tavora.notes", "valheim", "notes.json"), "{}");
    await mkdir(path.join(userData, "Partitions", "module%3Aofficial%3Atavora.discord@valheim"), { recursive: true });
    await mkdir(path.join(userData, "Partitions", "module%3Aofficial%3Atavora.notes@valheim"), { recursive: true });

    await moveOfficialModules(userData, () => undefined, files);

    expect(await readFile(path.join(data, OWNER, "wellbrained.discord", "_app", "settings.json"), "utf8")).toBe('{"last":1}');
    expect(await readFile(path.join(data, OWNER, "wellbrained.discord", "valheim", "settings.json"), "utf8")).toBe('{"server":1}');
    expect(await readFile(path.join(data, OWNER, "wellbrained.ai-usage", "_app", "settings.json"), "utf8")).toBe('{"order":[]}');
    expect((await readdir(path.join(data, "official"))).sort()).toEqual(["tavora.notes"]);
    expect((await readdir(path.join(userData, "Partitions"))).sort()).toEqual([`module%3A${OWNER}%3Awellbrained.discord@valheim`, "module%3Aofficial%3Atavora.notes@valheim"]);
  });

  it("keep what the catalog module already saved in a workspace", async () => {
    const userData = await mkdtemp(path.join(tmpdir(), "tavora-moved-"));
    const data = path.join(userData, "module-data");
    await put(path.join(data, "official", "tavora.discord", "valheim", "settings.json"), "old");
    await put(path.join(data, OWNER, "wellbrained.discord", "valheim", "settings.json"), "new");
    const lines: string[] = [];

    await moveOfficialModules(userData, (line) => lines.push(line), path.join(userData, "module-files"));

    expect(await readFile(path.join(data, OWNER, "wellbrained.discord", "valheim", "settings.json"), "utf8")).toBe("new");
    expect(await readFile(path.join(data, "official", "tavora.discord", "valheim", "settings.json"), "utf8")).toBe("old");
    expect(lines).toHaveLength(1);
  });

  it("move their panels, overlays, stream links and hotkeys, and nothing of other owners", async () => {
    const userData = await mkdtemp(path.join(tmpdir(), "tavora-moved-"));
    await put(
      path.join(userData, "workspace.json"),
      JSON.stringify({ version: 2, games: { valheim: { instances: [{ instanceId: "a", moduleId: "tavora.discord" }, { instanceId: "b", moduleId: "tavora.notes" }], snapshots: [{ id: "s", modules: { a: "tavora.ai-usage", b: "tavora.notes" } }] } } }),
    );
    await put(
      path.join(userData, "game-overlays.json"),
      JSON.stringify({ version: 2, overlays: [{ owner: "official", moduleId: "tavora.discord", gameId: "valheim", key: "voice" }], panels: [] }),
    );
    await put(path.join(userData, "overlays.json"), JSON.stringify({ version: 1, links: [{ owner: "local", moduleId: "tavora.discord", key: "voice" }] }));
    await put(path.join(userData, "hotkeys.json"), JSON.stringify({ version: 1, hotkeys: [{ owner: "official", moduleId: "tavora.ai-usage", action: "x" }] }));

    await moveOfficialModules(userData, () => undefined, path.join(userData, "module-files"));

    const workspace = JSON.parse(await readFile(path.join(userData, "workspace.json"), "utf8"));
    expect(workspace.games.valheim.instances.map((i: { moduleId: string }) => i.moduleId)).toEqual(["wellbrained.discord", "tavora.notes"]);
    expect(workspace.games.valheim.snapshots[0].modules).toEqual({ a: "wellbrained.ai-usage", b: "tavora.notes" });
    expect(JSON.parse(await readFile(path.join(userData, "game-overlays.json"), "utf8")).overlays[0]).toMatchObject({ owner: OWNER, moduleId: "wellbrained.discord" });
    // Not the official copy's: left alone.
    expect(JSON.parse(await readFile(path.join(userData, "overlays.json"), "utf8")).links[0]).toMatchObject({ owner: "local", moduleId: "tavora.discord" });
    expect(JSON.parse(await readFile(path.join(userData, "hotkeys.json"), "utf8")).hotkeys[0]).toMatchObject({ owner: OWNER, moduleId: "wellbrained.ai-usage" });
  });

  it("do nothing when there is nothing of theirs", async () => {
    const userData = await mkdtemp(path.join(tmpdir(), "tavora-moved-"));
    await moveOfficialModules(userData, () => undefined, path.join(userData, "module-files"));
    expect(await readdir(userData)).toEqual([]);
  });

  it("are known by their catalog ids only", () => {
    expect(movedModule("wellbrained.discord")?.name).toBe("Discord");
    expect(movedModule("tavora.discord")).toBeUndefined();
    expect(movedModule("wellbrained.poe2-builds")).toBeUndefined();
  });
});
