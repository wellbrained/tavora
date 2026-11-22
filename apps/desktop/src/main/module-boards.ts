import { OFFICIAL_OWNER, translateManifest } from "@tavora/module-schema";
import type { ProfileRanksView } from "../shared/host-api";
import { translate, type Language } from "../shared/i18n";
import type { Installed } from "./installed-modules";
import { boardsModuleId, ModuleLeaderboards, type LeaderboardAccount, type LeaderboardQuestion } from "./leaderboards";
import { UserError } from "./messages";
import { profileRanks, type ProfileRankAccount, type ProfileRankSource } from "./profile-ranks";
import type { InstalledModule } from "./registry";

export interface ModuleBoardsOptions {
  installed: Installed;
  /** The user's Tavora account, which reaches the leaderboards. */
  account: LeaderboardAccount & ProfileRankAccount;
  language: () => Language;
}

/**
 * Tavora's leaderboards for the installed modules: a module's own boards for its panels, the ranks on the profile card,
 * and leaving a module's boards from Settings. Only Tavora's own modules and those from the catalog go by their own id;
 * any other copy gets test boards (boardsModuleId), so it never reaches the boards of the module it claims to be. The
 * profile card lists only the modules that go by their own id.
 */
export class ModuleBoards {
  constructor(private readonly options: ModuleBoardsOptions) {}

  /** A module's leaderboards (leaderboards.ts); `ask` shows Tavora's question in the panel that asks. */
  of(module: InstalledModule, ask: (question: LeaderboardQuestion) => Promise<boolean>): ModuleLeaderboards {
    const language = this.options.language();
    return new ModuleLeaderboards({
      moduleId: boardsModuleId(module.manifest.id, this.listed(module)),
      boards: translateManifest(module.manifest, language).leaderboards?.boards ?? [],
      account: this.options.account,
      pseudonym: (label) => (label ? translate(this.options.language(), "leaderboards.pseudonym", { label }) : translate(this.options.language(), "leaderboards.someone")),
      ask,
    });
  }

  /** The profile card's ranks: the listed modules with boards the user agreed to be shown on (profile-ranks.ts). */
  async ranks(): Promise<ProfileRanksView> {
    const language = this.options.language();
    const sources: ProfileRankSource[] = [...this.options.installed.modules.values()]
      .filter((module) => this.listed(module) && (module.manifest.leaderboards?.boards.length ?? 0) > 0)
      .map((module) => ({
        id: module.manifest.id,
        name: translateManifest(module.manifest, language).name,
        boards: module.manifest.leaderboards?.boards ?? [],
        leaderboards: this.of(module, async () => false),
      }));
    return profileRanks(this.options.account, sources);
  }

  /** Settings > Integrations > Leaderboards: takes the user off a module's boards, whatever the module offers. */
  async leave(moduleId: string): Promise<void> {
    const module = this.options.installed.get(moduleId);
    if (!module) return;
    try {
      await this.of(module, async () => false).hide();
    } catch {
      throw new UserError("account.error.unreachable");
    }
  }

  /** Tavora's own module, or one installed from the catalog: its boards are the catalog's. */
  private listed(module: InstalledModule): boolean {
    return module.owner === OFFICIAL_OWNER || this.options.installed.catalog.has(module.manifest.id);
  }
}
