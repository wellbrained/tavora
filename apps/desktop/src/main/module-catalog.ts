import path from "node:path";
import { translateManifest } from "@tavora/module-schema";
import type { CatalogListResult, CatalogPageResult, CatalogReviews, CatalogReviewsResult, ModulePageResult, ReleaseStatus } from "../shared/host-api";
import { translate, type Language } from "../shared/i18n";
import { askKey, type AskedGame } from "../shared/module-request";
import { compareModuleVersions } from "../shared/module-version";
import { catalogView, type CatalogClient, type CatalogScope } from "./catalog-client";
import { parseReadme, readmeAllowsLink } from "./catalog-readme";
import { CHECK_INTERVAL_MS, type CatalogUpdater } from "./catalog-updates";
import { isWebUrl } from "./browser-url";
import { readOwnerRecords } from "./installer";
import type { Installed } from "./installed-modules";
import { MAX_ASKED_MODULES, type Library } from "./library";
import { UserError } from "./messages";
import { newInstallId } from "./module-request";
import { readModulePage } from "./module-page";
import { supportTarget } from "./module-support";
import { isReleaseCopies, releaseStatuses } from "./release-pending";
import { learnGameIds, workspaceGameIds, type ListedGame } from "./workspace-game";

/** How long after start the first update check waits, so it never slows the start. */
const FIRST_CHECK_MS = 30_000;

/** What Tavora asks the catalog (catalog-client.ts). */
export type CatalogPort = Pick<
  CatalogClient,
  "list" | "index" | "module" | "details" | "picture" | "icon" | "report" | "reviews" | "reviewerPicture" | "ownReview" | "rate" | "unrate" | "reply" | "reportReview"
>;

/** How many modules one update check updated, how many wait for the user, and whether it could not finish. */
export interface UpdateCheck {
  updated: number;
  waiting: number;
  unreachable?: true;
  failed?: number;
}

export interface ModuleCatalogOptions {
  library: Library;
  saveLibrary: () => void;
  installed: Installed;
  catalog: CatalogPort;
  /** Where the installer keeps its records of what it installed from the catalog (installer.ts readOwnerRecords). */
  userData: string;
  /** The account's sign-in, when there is one. */
  token: () => string | null;
  /** The versions of the developer's modules waiting for review (account.ts waitingVersions). */
  waitingVersions: () => Promise<{ id: string; version: string }[]>;
  /** Looks for updates of the modules installed from the catalog (catalog-updates.ts). */
  updates: Pick<CatalogUpdater, "check">;
  language: () => Language;
  /** The workspace shown now, by id; null on Home. */
  shownWorkspace: () => string | null;
  /** Opens a web address like a link from a module: the workspace's Browser panel, or where the user picks. */
  openLink: (url: string) => void;
  /** Opens a mailto: address in the user's mail app; null when nothing may open (test runs). */
  openExternal: ((url: string) => void) | null;
  /** Sends one anonymous Ask for a module vote; whether the service took it (module-request.ts). */
  sendRequest: (game: AskedGame, installId: string) => Promise<boolean>;
  /** A short message for the user, shown as a toast. */
  notify: (message: string) => void;
  /** Something the host UI shows changed: tell it now. */
  changed: () => void;
  /** Something the host UI shows changed: tell it once for a burst. */
  changedSoon: () => void;
  /** Checks for updates on its own, a little after start and then every few hours; test runs check only when asked. */
  checks: boolean;
}

/**
 * The module catalog as Tavora uses it: the Browse tab and a module's page, ratings and reviews, Ask for a module,
 * reporting, links from a listing, and the update checks of modules installed from it. Every address a page opens is
 * read again from the listing or the module, never taken from the page; nothing is asked while online features are off.
 */
export class ModuleCatalog {
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly options: ModuleCatalogOptions) {}

  /** The scope a host page asked for (a workspace, or a game), else the open workspace's. */
  scopeOf(target: unknown): CatalogScope | null {
    const asked = typeof target === "object" && target !== null ? (target as Record<string, unknown>) : {};
    if (typeof asked.game === "string" && asked.game.length <= 80) return { games: [asked.game] };
    if (typeof asked.workspaceId === "string") return this.scope(asked.workspaceId);
    return this.scope(this.options.shownWorkspace());
  }

  /** Where the Browse tab of the module library looks: a game workspace's game, or a personal workspace. */
  scope(workspaceId: string | null): CatalogScope | null {
    const workspace = workspaceId ? this.options.library.workspaces[workspaceId] : undefined;
    if (!workspace) return null;
    return workspace.kind === "personal" ? { personal: true } : { games: workspaceGameIds(workspace) };
  }

  /** The Browse tab's list for the workspace or game a page asked for (`target`), else for the open one. */
  async browse(target: unknown): Promise<CatalogListResult> {
    if (!this.options.library.onlineSearch) return { status: "off" };
    if (!this.scopeOf(target)) {
      // A named workspace it can't find is "can't tell", never an empty list: the empty page would read that as "no modules
      // for this game". With no workspace open at all, there is simply nothing that fits.
      const named = typeof target === "object" && target !== null && "workspaceId" in target;
      return named ? { status: "unavailable" } : { status: "ok", modules: [] };
    }
    // Asked again once the listing was read: a game added by name may just have learned its game's id from it.
    return this.options.catalog.list(() => this.scopeOf(target) ?? { games: [] }, this.options.language());
  }

  /** Every listed module, for the games list. */
  async forGames(): Promise<CatalogListResult> {
    if (!this.options.library.onlineSearch) return { status: "off" };
    return this.options.catalog.list({ games: [] }, this.options.language());
  }

  /** A game added by name learns its game's id from a catalog listing (workspace-game.ts); saved, and the rail sees what now fits. */
  learn(games: ListedGame[]): void {
    if (!learnGameIds(this.options.library, games).length) return;
    this.options.saveLibrary();
    this.options.changedSoon();
  }

  /**
   * A catalog module's page: the listing asked for again, its readme as plain text blocks and its screenshots, each
   * checked on its own (catalog-client.ts); a screenshot that fails is left out.
   */
  async page(moduleId: string): Promise<CatalogPageResult> {
    if (!this.options.library.onlineSearch) return { status: "off" };
    let details;
    try {
      details = await this.options.catalog.details(moduleId);
    } catch (error) {
      return { status: loadFailure(error, false) };
    }
    const shots = await Promise.all(details.entry.shots.map((shot) => this.options.catalog.picture(shot)));
    return {
      status: "ok",
      module: catalogView(details.entry, this.options.language(), this.scope(this.options.shownWorkspace()) ?? undefined),
      screenshots: shots.filter((url): url is string => url !== null),
      readme: details.readme === null ? [] : parseReadme(details.readme),
      versions: details.versions,
    };
  }

  /** An installed module's page from its own folder (module-page.ts), so it works offline. */
  async installedPage(moduleId: string): Promise<ModulePageResult> {
    const module = this.options.installed.get(moduleId);
    if (!module) return { status: "gone" };
    return { status: "ok", ...(await readModulePage(module.root, module.manifest)) };
  }

  /**
   * A catalog module's ratings and reviews (decided 2026-10-21), with the user's own rating and what they can do. Rating
   * needs a sign-in, not the module installed: someone who removed a bad module can still rate it (decided 2026-10-27).
   * Each reviewer's picture is fetched by its hash and checked like a listed picture.
   */
  async reviews(moduleId: string): Promise<CatalogReviewsResult> {
    const { catalog } = this.options;
    if (!this.options.library.onlineSearch) return { status: "off" };
    const token = this.options.token();
    let listed;
    let own: { mine: CatalogReviews["mine"]; own: boolean } = { mine: null, own: false };
    try {
      listed = await catalog.reviews(moduleId);
      if (token) own = await catalog.ownReview(moduleId, token).catch(() => own);
    } catch (error) {
      return { status: loadFailure(error, true) };
    }
    const pictures = await Promise.all(listed.reviews.map((review) => (review.author.picture ? catalog.reviewerPicture(review.id, review.author.picture) : null)));
    return {
      status: "ok",
      rating: listed.rating,
      reviews: listed.reviews.map((review, index) => ({ ...review, author: { ...review.author, picture: pictures[index] ?? null } })),
      mine: own.mine,
      can: own.own ? "own" : !token ? "sign-in" : "rate",
      installedVersion: this.options.installed.get(moduleId)?.manifest.version ?? null,
    };
  }

  /** Whether each of the developer's release copies is listed, waiting for review or not sent yet; null when it can't tell. */
  async releaseStatuses(copies: unknown): Promise<Record<string, ReleaseStatus> | null> {
    if (!this.options.library.onlineSearch || !isReleaseCopies(copies)) return null;
    const [index, waiting] = await Promise.all([this.options.catalog.index(), this.options.waitingVersions()]);
    return releaseStatuses(index, copies, waiting);
  }

  /** A listed module's icon, checked like a listed picture. */
  async icon(moduleId: string): Promise<string | null> {
    return this.options.library.onlineSearch ? this.options.catalog.icon(moduleId) : null;
  }

  /**
   * One anonymous vote for a module for a game that has none, because the user pressed Ask for a module. Remembered on
   * this PC, so the button stays a thanks; a vote that can't be sent (offline, or the service has no such address yet)
   * says so and can be tried again. Never blocks adding the game.
   */
  async ask(game: AskedGame): Promise<void> {
    const { library } = this.options;
    if (!game.name || [...game.name].length > 80) throw new UserError("error.askModuleFailed");
    const key = askKey(game);
    if (library.askedModules.includes(key)) return;
    if (!library.onlineSearch) throw new UserError("error.askModuleOff");
    if (!library.installId) {
      library.installId = newInstallId();
      this.options.saveLibrary();
    }
    if (!(await this.options.sendRequest(game, library.installId))) throw new UserError("error.askModuleFailed");
    library.askedModules = [...library.askedModules.filter((other) => other !== key), key].slice(-MAX_ASKED_MODULES);
    this.options.saveLibrary();
  }

  /**
   * Reports a module to Tavora (C12). A module installed from the catalog is reported as the zip that is installed, the
   * one the user has seen; any other id as the version the catalog lists now. Only the id, the key and the zip's hash
   * are sent, and only because the user pressed Report.
   */
  async report(moduleId: string, why: { reason: string; note: string | null }): Promise<void> {
    const { installed, catalog } = this.options;
    if (!this.options.library.onlineSearch) throw new UserError("error.reportOff");
    const token = this.options.token();
    if (!token) throw new UserError("error.reportSignIn");
    const module = installed.catalog.has(moduleId) ? (installed.modules.get(moduleId) ?? installed.blocked.get(moduleId)) : undefined;
    const record = module ? (await readOwnerRecords(this.options.userData))[path.basename(module.root)] : undefined;
    if (module && record?.id === moduleId && record.sha256) {
      await catalog.report({ id: moduleId, owner: module.owner, sha256: record.sha256 }, token, why);
      return;
    }
    const entry = await catalog.module(moduleId);
    await catalog.report({ id: entry.id, owner: entry.owner, sha256: entry.zip.sha256 }, token, why);
  }

  /**
   * Opens a catalog module's homepage like a link from a module (C10): only http or https, in the workspace's Browser
   * panel or where the user picks. The address comes from the listing, asked for again here.
   */
  async openHomepage(moduleId: string): Promise<void> {
    if (!this.options.library.onlineSearch) throw new UserError("error.catalogOff");
    const { homepage } = await this.options.catalog.module(moduleId);
    if (homepage && isWebUrl(homepage)) this.options.openLink(homepage);
  }

  /**
   * Opens a module's support link after a click. The link is read again here, from the installed module's own manifest
   * or the catalog listing, never taken from the page: a web address opens like the homepage, an email address in the
   * user's mail app.
   */
  async openSupport(moduleId: string, source: "catalog" | "installed"): Promise<void> {
    let link: string | null | undefined;
    if (source === "installed") link = this.options.installed.get(moduleId)?.manifest.support;
    else {
      if (!this.options.library.onlineSearch) throw new UserError("error.catalogOff");
      link = (await this.options.catalog.module(moduleId)).support;
    }
    const target = link ? supportTarget(link) : null;
    if (!target) return;
    if (target.kind === "web") this.options.openLink(target.url);
    else this.options.openExternal?.(target.url);
  }

  /**
   * Opens a link from a catalog module's readme in a Browser panel. The readme is read again here and the address must
   * be one of its http or https links, so the page can't ask for any other address.
   */
  async openReadmeLink(moduleId: string, url: string): Promise<void> {
    if (!this.options.library.onlineSearch) throw new UserError("error.catalogOff");
    const { readme } = await this.options.catalog.details(moduleId);
    if (!readmeAllowsLink(readme, url)) throw new UserError("error.readmeLink");
    this.options.openLink(url);
  }

  /**
   * Rates a catalog module on its installed version, which must be one the catalog published, or on its newest
   * published version when it isn't installed.
   */
  async rate(moduleId: string, stars: number, text: string | null): Promise<void> {
    const token = this.reviewToken();
    const installed = this.options.installed.get(moduleId)?.manifest.version;
    const { versions } = await this.options.catalog.details(moduleId);
    const version = installed ?? versions.map((published) => published.version).sort(compareModuleVersions).at(-1);
    if (!version || !versions.some((published) => published.version === version)) throw new UserError("error.reviewVersion");
    await this.options.catalog.rate(moduleId, token, { stars, text: text?.trim() || null, version });
  }

  /** Takes the user's own rating of a module away. */
  async unrate(moduleId: string): Promise<void> {
    await this.options.catalog.unrate(moduleId, this.reviewToken());
  }

  /** The developer's answer to a review of their module; null takes it away. */
  async reply(reviewId: string, text: string | null): Promise<void> {
    await this.options.catalog.reply(reviewId, this.reviewToken(), text?.trim() || null);
  }

  /** Reports a review to Tavora, because the user pressed Report on it. */
  reportReview(reviewId: string): Promise<void> {
    if (!this.options.library.onlineSearch) throw new UserError("error.reportOff");
    const token = this.options.token();
    if (!token) throw new UserError("error.reportSignIn");
    return this.options.catalog.reportReview(reviewId, token);
  }

  /** Looks for updates of modules installed from the catalog a little after start and then every few hours (`checks`). */
  startChecks(): void {
    if (!this.options.checks) return;
    setTimeout(() => void this.checkUpdates(), FIRST_CHECK_MS).unref?.();
    this.timer = setInterval(() => void this.checkUpdates(), CHECK_INTERVAL_MS);
    this.timer.unref?.();
  }

  stopChecks(): void {
    clearInterval(this.timer);
  }

  /**
   * One update check (catalog-updates.ts), only while online features are on. Updates that ask for nothing new are
   * installed and their panels reload; the others wait for the user, shown in Settings > Modules and on their panels.
   * Answers with how many modules were updated or are waiting.
   */
  async checkUpdates(): Promise<UpdateCheck> {
    if (!this.options.library.onlineSearch) return { updated: 0, waiting: 0 };
    const { updated, waiting, unreachable, failed } = await this.options.updates.check();
    const language = this.options.language();
    if (updated.length === 1) {
      const { manifest } = updated[0]!;
      this.options.notify(translate(language, "modules.catalogUpdated", { name: translateManifest(manifest, language).name, version: manifest.version }));
    } else if (updated.length > 1) {
      this.options.notify(translate(language, "modules.catalogUpdatedMany", { count: String(updated.length) }));
    }
    this.options.changed();
    return { updated: updated.length, waiting: waiting.length, ...(unreachable ? { unreachable } : {}), ...(failed ? { failed } : {}) };
  }

  /** Settings > Modules' Check for updates: never "up to date" when the catalog could not be asked or an update would not download. */
  async checkUpdatesNow(): Promise<{ ok: true; updated: number; waiting: number }> {
    if (!this.options.library.onlineSearch) throw new UserError("error.catalogOff");
    const { updated, waiting, unreachable, failed } = await this.checkUpdates();
    if (unreachable) throw new UserError("error.updatesUnreachable");
    if (failed && updated + waiting === 0) throw new UserError("error.updatesFailed");
    return { ok: true, updated, waiting };
  }

  /** The sign-in a review action needs: online features must be on, and the user signed in. */
  private reviewToken(): string {
    if (!this.options.library.onlineSearch) throw new UserError("error.catalogOff");
    const token = this.options.token();
    if (!token) throw new UserError("account.error.signedOut");
    return token;
  }
}

/** What a failed catalog read says to the page: the module is gone, the service (or its `reviews`) is down or busy, or it couldn't be reached. */
function loadFailure(error: unknown, reviews: boolean): "gone" | "unavailable" | "busy" | "unreachable" {
  const key = error instanceof UserError ? error.key : "";
  if (key === "error.catalogNotListed") return "gone";
  if (key === "error.catalogUnavailable" || (reviews && key === "error.reviewsUnavailable")) return "unavailable";
  if (key === "error.catalogBusy") return "busy";
  return "unreachable";
}
