import { describe, expect, it } from "vitest";
import type { LeaderboardBoard } from "@tavora/module-schema";
import type { LeaderboardMine, LeaderboardStatus } from "@tavora/sdk/protocol";
import { profileRanks, type ProfileRankSource } from "./profile-ranks";

const empty = { day: null, week: null, month: null, year: null, all: null };
const status = (extra: Partial<LeaderboardStatus> = {}): LeaderboardStatus => ({ online: true, signedIn: true, available: true, shown: true, name: "Mara", ...extra });
const boards: LeaderboardBoard[] = [
  { id: "daily", name: "Daily streak", kind: "streak", daily: true },
  { id: "pts", name: "Points", kind: "total", unit: "pts" },
];
const mine: LeaderboardMine = { boards: boards.map((board) => ({ id: board.id, name: board.name, periods: { ...empty, all: { rank: 1, of: 2 } } })) };

function source(id: string, options: { status?: LeaderboardStatus; fails?: boolean } = {}): ProfileRankSource {
  return {
    id,
    name: `Name of ${id}`,
    boards,
    leaderboards: {
      status: async () => options.status ?? status(),
      mine: async () => {
        if (options.fails) throw new Error("offline");
        return mine;
      },
    },
  };
}
const on = { enabled: () => true, isSignedIn: () => true };

describe("the profile card's ranks", () => {
  it("asks nothing while accounts are off or the user is signed out", async () => {
    expect(await profileRanks({ enabled: () => false, isSignedIn: () => false }, [source("a")])).toEqual({ online: false, signedIn: false, modules: [] });
    expect(await profileRanks({ enabled: () => true, isSignedIn: () => false }, [source("a")])).toEqual({ online: true, signedIn: false, modules: [] });
  });

  it("lists the modules the user is shown on, with what each board counts", async () => {
    const view = await profileRanks(on, [source("a"), source("b", { status: status({ shown: false }) })]);
    expect(view.online).toBe(true);
    expect(view.modules.map((module) => module.id)).toEqual(["a"]);
    expect(view.modules[0]).toMatchObject({ name: "Name of a" });
    expect(view.modules[0]!.boards).toMatchObject([{ id: "daily", kind: "streak", daily: true }, { id: "pts", kind: "total", unit: "pts" }]);
  });

  it("leaves out a module that fails, and is offline only when all of them do", async () => {
    const some = await profileRanks(on, [source("a"), source("b", { fails: true })]);
    expect(some).toMatchObject({ online: true });
    expect(some.modules.map((module) => module.id)).toEqual(["a"]);
    expect(await profileRanks(on, [source("a", { fails: true }), source("b", { status: status({ online: false }) })])).toEqual({ online: false, signedIn: true, modules: [] });
    expect(await profileRanks(on, [])).toEqual({ online: true, signedIn: true, modules: [] });
  });
});
