import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { GameIcons, type GameIconsOptions } from "./game-icons";
import { addWorkspace, emptyLibrary, type Library } from "./library";

const SERVICE = "https://service.test";

/** A valid one-frame ICO. */
const ICON = (() => {
  const bytes = new Uint8Array(6 + 16 + 30);
  const view = new DataView(bytes.buffer);
  view.setUint16(2, 1, true);
  view.setUint16(4, 1, true);
  view.setUint32(6 + 8, 30, true);
  view.setUint32(6 + 12, 22, true);
  return bytes;
})();

interface Service {
  /** The service's hosted icons, or null for no answer. */
  hosted?: { id: string; names: string[] }[] | null;
  /** The status each offer gets, in turn; 202 once they run out. */
  submits?: number[];
}

/** Game icons over a temp userData, a library with one game that has its own icon, and a fake Tavora service. */
async function setup(service: Service = {}, options: Partial<GameIconsOptions> = {}) {
  const userData = await mkdtemp(path.join(tmpdir(), "tavora-icons-"));
  const library: Library = emptyLibrary();
  const id = addWorkspace(library, { name: "Diablo IV" }, new Date());
  const game = library.workspaces[id]!;
  game.iconFile = `exe-${id}.ico`;
  await mkdir(path.join(userData, "steam-icons"), { recursive: true });
  await writeFile(path.join(userData, "steam-icons", game.iconFile), ICON);
  const offered: string[] = [];
  const submits = [...(service.submits ?? [])];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const address = String(url);
    if (address === `${SERVICE}/v1/icons`) {
      if (service.hosted === null) return new Response("", { status: 503 });
      const icons = (service.hosted ?? []).map((icon) => ({ ...icon, sha256: "a".repeat(64), size: 1 }));
      return Response.json({ notice: "", takedown: "", icons });
    }
    if (address === `${SERVICE}/v1/icons/submit`) {
      offered.push((JSON.parse(String(init?.body)) as { id: string }).id);
      return new Response("{}", { status: submits.shift() ?? 202 });
    }
    throw new Error(`unexpected fetch ${address}`);
  }) as unknown as typeof fetch;
  const saveLibrary = vi.fn();
  const pushState = vi.fn();
  const signedOut = vi.fn();
  const icons = new GameIcons({
    userData,
    library,
    saveLibrary,
    pushState,
    language: () => "en",
    steamIcons: undefined,
    apiUrl: SERVICE,
    token: () => "t".repeat(43),
    signedOut,
    seen: async () => ({}),
    shouldRun: () => true,
    desktop: () => undefined,
    smallBitmap: () => null,
    steamDir: async () => null,
    fetchImpl,
    offerPauseMs: 0,
    ...options,
  });
  /** Looks for icons, which also reads the service's list, and waits until the list is in. */
  const loadList = async () => {
    icons.lookSoon();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledWith(`${SERVICE}/v1/icons`, expect.anything()));
    await vi.waitFor(() => expect(pushState).toHaveBeenCalled());
  };
  return { userData, library, id, game, icons, fetchImpl, saveLibrary, pushState, signedOut, offered, loadList };
}

describe("GameIcons.view", () => {
  it("shows a game's own icon, with its version and tone, only while the user wants it", async () => {
    const { icons, game, library } = await setup();
    const view = icons.view(game);
    expect(view.iconChoice).toBe("original");
    expect(view.steamIcon).toMatch(new RegExp(`^tavora-host://app/steam-icons/${game.iconFile}\\?v=`));
    library.steamIcons = false;
    expect(icons.view(game)).toMatchObject({ steamIcon: null, steamIconTone: null });
  });

  it("offers a game's own icon only once the service's list says it has none", async () => {
    const { icons, game, loadList } = await setup({ hosted: [{ id: "starcraft-2", names: ["StarCraft II"] }] });
    expect(icons.view(game).shareIcon).toBeNull();
    await loadList();
    expect(icons.view(game).shareIcon).toBe(`tavora-host://app/steam-icons/${game.iconFile}`);
  });

  it("offers nothing for a game the service has an icon for", async () => {
    const { icons, game, loadList } = await setup({ hosted: [{ id: "other", names: ["Diablo IV"] }] });
    await loadList();
    expect(icons.view(game).shareIcon).toBeNull();
  });
});

describe("GameIcons.lookSoon", () => {
  it("does nothing while icons are off, in the library or for this run", async () => {
    const off = await setup();
    off.library.steamIcons = false;
    off.icons.lookSoon();
    const run = await setup({}, { steamIcons: "off" });
    run.icons.lookSoon();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(off.fetchImpl).not.toHaveBeenCalled();
    expect(run.fetchImpl).not.toHaveBeenCalled();
  });

  it("asks the service for its list once per run", async () => {
    const { icons, fetchImpl, loadList } = await setup();
    await loadList();
    icons.lookSoon();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(vi.mocked(fetchImpl).mock.calls.filter(([url]) => String(url).endsWith("/v1/icons"))).toHaveLength(1);
  });
});

describe("GameIcons.share", () => {
  it("sends a game's own icon, and never offers it again", async () => {
    const { icons, id, game, offered, saveLibrary, pushState, loadList } = await setup();
    await loadList();
    pushState.mockClear();
    expect(await icons.share([id])).toEqual({ ok: true, shared: 1 });
    expect(offered).toEqual([id]);
    expect(game.iconSharedAt).not.toBeNull();
    expect(saveLibrary).toHaveBeenCalled();
    expect(pushState).toHaveBeenCalled();
    expect(icons.view(game).shareIcon).toBeNull();
    expect(await icons.share([id])).toEqual({ ok: false, error: "There's nothing to share right now." });
  });

  it("asks a signed-out user to sign in first", async () => {
    const { icons, id, offered, loadList } = await setup({}, { token: () => null });
    await loadList();
    expect(await icons.share([id])).toEqual({ ok: false, error: "Sign in to share icons." });
    expect(offered).toEqual([]);
  });

  it("lets the account side find out when the service says the sign-in is gone", async () => {
    const { icons, id, game, signedOut, loadList } = await setup({ submits: [401] });
    await loadList();
    expect(await icons.share([id])).toEqual({ ok: false, error: "Sign in to share icons." });
    expect(signedOut).toHaveBeenCalledTimes(1);
    expect(game.iconSharedAt).toBeNull();
  });

  it("stops when the service is busy or can't be reached, and offers the icon again later", async () => {
    const busy = await setup({ submits: [429] });
    await busy.loadList();
    expect(await busy.icons.share([busy.id])).toMatchObject({ ok: false, error: expect.stringContaining("only a few icons an hour") });
    expect(busy.game.iconSharedAt).toBeNull();
    const down = await setup({ submits: [503] });
    await down.loadList();
    expect(await down.icons.share([down.id])).toMatchObject({ ok: false });
    expect(down.icons.view(down.game).shareIcon).not.toBeNull();
  });

  it("does not offer again an icon the service refused for good", async () => {
    const { icons, id, game, loadList } = await setup({ submits: [409] });
    await loadList();
    expect(await icons.share([id])).toEqual({ ok: true, shared: 0 });
    expect(game.iconSharedAt).not.toBeNull();
  });

  it("offers nothing before the service's list is in", async () => {
    const { icons, id, offered } = await setup();
    expect(await icons.share([id])).toEqual({ ok: false, error: "There's nothing to share right now." });
    expect(offered).toEqual([]);
  });
});

describe("GameIcons.steamShareIcons", () => {
  it("says why nothing can be offered: online features off, icons off, no answer, or no Steam", async () => {
    const offline = await setup();
    offline.library.onlineSearch = false;
    expect(await offline.icons.steamShareIcons([1])).toMatchObject({ status: "error" });
    const unreachable = await setup({ hosted: null });
    expect(await unreachable.icons.steamShareIcons([1])).toMatchObject({ status: "error" });
    const noSteam = await setup();
    expect(await noSteam.icons.steamShareIcons([1])).toMatchObject({ status: "error" });
    expect(await noSteam.icons.shareSteam([1])).toEqual({ ok: false, error: "There's nothing to share right now." });
  });
});

describe("GameIcons.choose and forget", () => {
  it("removes a picked picture once the workspace shows something else", async () => {
    const { icons, id, game, userData } = await setup();
    const source = path.join(userData, "mine.png");
    // A PNG signature and an IHDR are enough for the import's check.
    const png = new Uint8Array(80);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 1, 0, 0, 0, 1, 0]);
    await writeFile(source, png);
    const file = await icons.importImage(id, source);
    await icons.choose(id, { kind: "image", file });
    expect(icons.view(game)).toMatchObject({ iconChoice: "image", icon: { kind: "image", url: `tavora-host://app/game-icons/${file}` } });
    expect(existsSync(path.join(userData, "game-icons", file))).toBe(true);

    await icons.choose(id, { kind: "label", label: "D4" });
    expect(icons.view(game)).toMatchObject({ iconChoice: "letters", icon: { kind: "monogram", text: "D4" } });
    expect(existsSync(path.join(userData, "game-icons", file))).toBe(false);

    await icons.choose(id, { kind: "original" });
    expect(icons.view(game).iconChoice).toBe("original");
  });

  it("keeps a game's icon file another game still uses", async () => {
    const { icons, library, game, userData } = await setup();
    const file = path.join(userData, "steam-icons", game.iconFile!);
    const other = library.workspaces[addWorkspace(library, { name: "Diablo IV Beta" }, new Date())]!;
    other.iconFile = game.iconFile;
    await icons.forget(game);
    expect(existsSync(file)).toBe(true);
    delete library.workspaces[game.id];
    await icons.forget(other);
    expect(existsSync(file)).toBe(false);
  });
});

describe("GameIcons.installedGames", () => {
  it("lists the PC's games with the workspace each one already has", async () => {
    const { icons, id } = await setup(
      {},
      {
        testInstalled: [
          { source: "battlenet", name: "Diablo IV", file: "C:\\missing\\Diablo IV.exe", index: 0 },
          { source: "epic", name: "Hades", file: "C:\\missing\\Hades.exe", index: 0 },
        ],
      },
    );
    const games = await icons.installedGames();
    expect(games.map((game) => [game.name, game.workspaceId, game.icon])).toEqual(
      expect.arrayContaining([
        ["Diablo IV", id, null],
        ["Hades", null, null],
      ]),
    );
  });
});
