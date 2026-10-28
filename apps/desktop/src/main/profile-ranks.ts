import type { LeaderboardBoard } from "@tavora/module-schema";
import type { LeaderboardMine, LeaderboardStatus } from "@tavora/sdk/protocol";
import type { ProfileRankBoard, ProfileRanksView } from "../shared/host-api";

// The profile card's "Your ranks" (decided 2026-10-28): the user's standing on the boards of the catalog modules they
// agreed to be shown on. Development copies are never listed, so the caller passes only catalog and Tavora's own modules.

/** One module that may be listed: its translated name, its boards and its leaderboards connection. */
export interface ProfileRankSource {
  id: string;
  name: string;
  boards: readonly LeaderboardBoard[];
  leaderboards: { status(): Promise<LeaderboardStatus>; mine(params: unknown): Promise<LeaderboardMine> };
}

/** What the card needs of the account. */
export interface ProfileRankAccount {
  enabled(): boolean;
  isSignedIn(): boolean;
}

/**
 * Asks every module in parallel and lists those the user agreed to be shown on. A module whose request fails is left
 * out; when every module that was asked failed, the service is unreachable (`online` false).
 */
export async function profileRanks(account: ProfileRankAccount, sources: readonly ProfileRankSource[]): Promise<ProfileRanksView> {
  if (!account.enabled()) return { online: false, signedIn: false, modules: [] };
  if (!account.isSignedIn()) return { online: true, signedIn: false, modules: [] };
  const answers = await Promise.all(
    sources.filter((source) => source.boards.length > 0).map(async (source) => {
      try {
        const status = await source.leaderboards.status();
        if (!status.online) return "failed" as const;
        if (!status.shown) return null;
        const { boards } = await source.leaderboards.mine({});
        const listed = boards.flatMap((board): ProfileRankBoard[] => {
          const declared = source.boards.find((item) => item.id === board.id);
          if (!declared) return [];
          return [{
            id: board.id,
            name: board.name,
            kind: declared.kind,
            ...(declared.kind === "streak" && declared.daily ? { daily: true } : {}),
            ...("unit" in declared && declared.unit ? { unit: declared.unit } : {}),
            periods: board.periods,
          }];
        });
        return { id: source.id, name: source.name, boards: listed };
      } catch {
        return "failed" as const;
      }
    }),
  );
  const failed = answers.filter((answer) => answer === "failed").length;
  return {
    online: answers.length === 0 || failed < answers.length,
    signedIn: true,
    modules: answers.filter((answer): answer is Exclude<typeof answer, "failed" | null> => answer !== null && answer !== "failed"),
  };
}
