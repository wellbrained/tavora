import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InstalledGameView } from "../../shared/host-api";

const installedGames = vi.fn<() => Promise<InstalledGameView[]>>();
vi.mock("../host", () => ({ api: { installedGames: () => installedGames() } }));

const { findInstalledGames, lastInstalledGames, resetInstalledGames } = await import("./installed-games");

const game = (name: string): InstalledGameView => ({ key: `n:${name}`, name, steamAppId: null, catalogId: null, icon: null, activity: null, workspaceId: null });

beforeEach(() => {
  installedGames.mockReset();
  resetInstalledGames();
});

describe("installed games", () => {
  it("has no list until a search has finished, then keeps the last one", async () => {
    installedGames.mockResolvedValue([game("Zelda")]);
    expect(lastInstalledGames()).toBeNull();
    await findInstalledGames();
    expect(lastInstalledGames()?.map((item) => item.name)).toEqual(["Zelda"]);
  });

  it("joins a search that is already running", async () => {
    let finish: (games: InstalledGameView[]) => void = () => undefined;
    installedGames.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const first = findInstalledGames();
    const second = findInstalledGames();
    finish([game("Zelda")]);
    expect(await first).toBe(await second);
    expect(installedGames).toHaveBeenCalledTimes(1);
  });

  it("refreshes the list on the next search", async () => {
    installedGames.mockResolvedValueOnce([game("Zelda")]).mockResolvedValueOnce([game("Zelda"), game("Elden Ring")]);
    await findInstalledGames();
    await findInstalledGames();
    expect(lastInstalledGames()).toHaveLength(2);
  });

  it("keeps the last list when a search fails", async () => {
    installedGames.mockResolvedValueOnce([game("Zelda")]).mockRejectedValueOnce(new Error("gone"));
    await findInstalledGames();
    expect(await findInstalledGames()).toHaveLength(1);
    expect(lastInstalledGames()).toHaveLength(1);
  });
});
