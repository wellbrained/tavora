// What an update must never do: lose or misread what an older Tavora saved.
// The fixtures are files as the first numbered version (0.1.0) wrote them; later
// versions added fields, so they must all load with sensible defaults.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyLibrary, sanitizeLibrary } from "./library";
import { sanitizeProfile } from "./profile";
import { SUPPORTED_VERSIONS } from "./saved-data";
import { emptyWorkspace, loadWorkspace, saveWorkspace } from "./workspace";

/** library.json as 0.1.0 wrote it. */
const LIBRARY_0_1_0 = {
  version: 1,
  games: {
    poe2: { id: "poe2", catalogId: "poe2", name: "Path of Exile 2", icon: { kind: "monogram", text: "PE2" }, showNews: true, addedAt: "2026-10-14T10:00:00.000Z", lastPlayedAt: "2026-10-15T09:00:00.000Z", trashedAt: null },
    "local-my-game": { id: "local-my-game", catalogId: null, name: "My Game", icon: { kind: "image", file: "local-my-game-1a2b3c4d.png" }, showNews: false, addedAt: "2026-10-14T11:00:00.000Z", lastPlayedAt: null, trashedAt: null },
    "elden-ring": { id: "elden-ring", catalogId: "elden-ring", name: "Elden Ring", icon: { kind: "monogram", text: "ER" }, showNews: true, addedAt: "2026-10-12T11:00:00.000Z", lastPlayedAt: null, trashedAt: "2026-10-14T12:00:00.000Z" },
  },
  folders: { "11111111-1111-4111-8111-111111111111": { id: "11111111-1111-4111-8111-111111111111", name: "ARPGs", label: "AR", games: ["poe2"] } },
  root: [{ kind: "folder", id: "11111111-1111-4111-8111-111111111111" }, { kind: "game", id: "local-my-game" }],
  favorites: ["local-my-game"],
  sort: "manual",
  rail: { expanded: true, width: 300 },
  startup: "welcome",
  grayscaleText: true,
  onlineSearch: false,
  lastGameId: "poe2",
};

describe("a library saved by 0.1.0", () => {
  const library = sanitizeLibrary(structuredClone(LIBRARY_0_1_0));

  it("keeps every game, folder, favorite and the player's choices", () => {
    expect(Object.keys(library.games).sort()).toEqual(["elden-ring", "local-my-game", "poe2"]);
    expect(library.games["elden-ring"]!.trashedAt).toBe("2026-10-14T12:00:00.000Z");
    expect(library.games["local-my-game"]!.icon).toEqual({ kind: "image", file: "local-my-game-1a2b3c4d.png" });
    expect(library.folders["11111111-1111-4111-8111-111111111111"]).toMatchObject({ name: "ARPGs", label: "AR", games: ["poe2"] });
    expect(library.root).toEqual(LIBRARY_0_1_0.root);
    expect(library.favorites).toEqual(["local-my-game"]);
    expect(library).toMatchObject({ sort: "manual", startup: "welcome", grayscaleText: true, onlineSearch: false, lastGameId: "poe2" });
    expect(library.rail).toEqual({ expanded: true, width: 300 });
  });

  it("gives settings that did not exist yet their defaults, and does not show the welcome again", () => {
    expect(library.autoUpdate).toBe(true);
    expect(library.steamIcons).toBe(true);
    expect(library.onboarded).toBe(true);
    // Nobody had chosen light or dark before, so the theme follows the system.
    expect(library.followSystem).toBe(true);
    // Fields added later start empty on games saved before them.
    expect(library.games.poe2).toMatchObject({ iconFile: null, iconCheckedAt: null });
  });

  it("writes something this version reads back unchanged", () => {
    expect(sanitizeLibrary(JSON.parse(JSON.stringify(library)))).toEqual(library);
  });
});

describe("a library from a newer Tavora", () => {
  it("keeps the games it understands and ignores fields it does not know", () => {
    const newer = { ...structuredClone(LIBRARY_0_1_0), version: 7, somethingNew: { a: 1 }, games: { ...LIBRARY_0_1_0.games, poe2: { ...LIBRARY_0_1_0.games.poe2, futureField: true } } };
    const library = sanitizeLibrary(newer);
    expect(Object.keys(library.games).sort()).toEqual(["elden-ring", "local-my-game", "poe2"]);
    expect(library.games.poe2).not.toHaveProperty("futureField");
  });
});

describe("the versions this Tavora writes", () => {
  it("are the versions it declares it understands", () => {
    expect(emptyLibrary().version).toBe(SUPPORTED_VERSIONS["library.json"]);
    expect(emptyWorkspace([]).version).toBe(SUPPORTED_VERSIONS["workspace.json"]);
    expect(sanitizeProfile(null).version).toBe(SUPPORTED_VERSIONS["profile.json"]);
  });
});

describe("a workspace saved before layouts existed (version 1)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "tavora-compat-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("opens with its panels, and is saved as the current version", async () => {
    const file = path.join(dir, "workspace.json");
    const panel = "22222222-2222-4222-8222-222222222222";
    await writeFile(file, JSON.stringify({ version: 1, games: { poe2: { instances: [{ instanceId: panel, moduleId: "tavora.notes" }] } } }));
    const workspace = await loadWorkspace(file, ["poe2"], (id) => id === "tavora.notes");
    expect(workspace.games.poe2!.instances).toEqual([{ instanceId: panel, moduleId: "tavora.notes" }]);
    await saveWorkspace(file, workspace);
    expect(JSON.parse(await readFile(file, "utf8")).version).toBe(SUPPORTED_VERSIONS["workspace.json"]);
  });

  it("drops panels of modules that are gone but keeps the game", async () => {
    const file = path.join(dir, "workspace.json");
    await mkdir(dir, { recursive: true });
    await writeFile(file, JSON.stringify({ version: 2, games: { poe2: { instances: [{ instanceId: "22222222-2222-4222-8222-222222222222", moduleId: "local.removed" }] } } }));
    const workspace = await loadWorkspace(file, ["poe2"], () => false);
    expect(workspace.games.poe2!.instances).toEqual([]);
  });
});
