import { readFile } from "node:fs/promises";
import path from "node:path";
import type { IconTone } from "../shared/icon-tone";
import { translate, type Language, type MessageKey } from "../shared/i18n";
import type { ActionResult, InstalledGameView, SteamImportGame, SteamShareResult, SteamShareView, WorkspaceView } from "../shared/host-api";
import { HOST_SCHEME } from "./assets";
import { gameCopyFinder } from "./game-copy";
import { fetchHostedList, type HostedList } from "./hosted-icons";
import { createToneReader, iconVersions } from "./icon-tone";
import { syncIcons } from "./icon-sync";
import { importIcon, removeIcon } from "./icons";
import { pickGames, withInstallDates } from "./installed-list";
import { findInstalledGames, type InstalledGame } from "./launcher-games";
import {
  iconFileShared,
  markIconOffered,
  markIconShared,
  setWorkspaceImage,
  setWorkspaceLabel,
  useOriginalWorkspaceIcon,
  type Library,
  type WorkspaceEntry,
  type WorkspaceIcon,
} from "./library";
import { readIcoFromFile } from "./pe-icon";
import { serviceUrl } from "./service-url";
import { icoFrameNear, isShareCandidate, largestIcoFrame, shareableIconFile, shareSource, steamShareGames, submitIcon } from "./share-icons";
import { AppInfoError, readClientIcons } from "./steam-appinfo";
import { coverReader, findSteamDir, loadAppInfo, readLibraryCover, readSteamClientIcon, removeSteamIcon } from "./steam-icons";
import { steamGameStatus } from "./steam-import";
import { readSteamLastPlayed } from "./steam-played";
import { readShortcutIcons, shortcutFolders } from "./steam-shortcuts";

const ICON_URL = `${HOST_SCHEME}://app/game-icons/`;
const STEAM_ICON_URL = `${HOST_SCHEME}://app/steam-icons/`;

export interface GameIconsOptions {
  userData: string;
  /** The library the icons belong to; `changed` saves it and refreshes the host UI. */
  library: Library;
  saveLibrary: () => void;
  pushState: () => void;
  language: () => Language;
  /** HostOptions.steamIcons: where icons come from instead of Steam's public address, or "off" for this run. */
  steamIcons: string | undefined;
  /** The Tavora service. */
  apiUrl: string | undefined;
  /** The games "installed" in a test run, instead of the launchers' (and no Steam). */
  testInstalled?: InstalledGame[] | undefined;
  /** The user's sign-in, for offering icons; null when signed out. */
  token: () => string | null;
  /** The service said the sign-in is gone: the account side finds out. */
  signedOut: () => void;
  /** When each installed game was last seen running (games-seen.ts). */
  seen: () => Promise<Record<string, number>>;
  /** False stops a look for icons, e.g. the window closed. */
  shouldRun: () => boolean;
  /** Where Windows says the Desktop is (OneDrive can move it), or undefined when it can't say. */
  desktop: () => string | undefined;
  /** A saved icon as a 32 px bitmap (blue, green, red, alpha), or null when it cannot be read. */
  smallBitmap: (file: string) => Uint8Array | null;
  /** The Steam client's folder on this PC, or null; findSteamDir unless a test says otherwise. */
  steamDir?: () => Promise<string | null>;
  fetchImpl?: typeof fetch | undefined;
  /** Pause between two offers, so the service is never hit in a burst. */
  offerPauseMs?: number;
}

/** How a workspace's icon is shown (WorkspaceView). */
export type IconView = Pick<WorkspaceView, "icon" | "steamIcon" | "steamIconTone" | "iconChoice" | "shareIcon">;

/** A change to the icon the user picked for a workspace. */
export type IconChoice = { kind: "label"; label: unknown } | { kind: "original" } | { kind: "image"; file: string };

/**
 * Game icons and covers (game-icons.ts): the icons of the library's games, found quietly in the background and saved
 * under userData, the icons and covers of the Add a game list, and offering a game's own icon to the Tavora service.
 * Only files already on this PC and the service's and Steam's public addresses are read; no game process is touched.
 */
export class GameIcons {
  private readonly iconDir: string;
  private readonly steamIconDir: string;
  private readonly steamDir: () => Promise<string | null>;
  private iconsRunning = false;
  private iconsAgain = false;
  /** The service's list of hosted icons, asked for once per run, or null (off, or it did not answer). */
  private hostedList: HostedList | null = null;
  private hostedListLoading: Promise<HostedList | null> | null = null;
  /** The icons the Add a game list read, by game key, so the PC's programs are opened once. */
  private readonly pickerIcons = new Map<string, string | null>();
  /** The Add a game covers, by Steam app id: Steam's own cover art from this PC's library cache, read once each. */
  private readonly pickerCovers = coverReader(async (appids) => {
    const steamDir = this.options.testInstalled ? null : await this.steamDir();
    return Promise.all(appids.map((appid) => (steamDir ? readLibraryCover(steamDir, appid) : null)));
  });
  /** The games of the last Steam look-up, kept so their icons can be offered without adding them. */
  private steamLookup: SteamImportGame[] = [];
  /** The icons steamShareIcons found on this PC, by Steam appid, ready to be sent as they were shown. */
  private readonly steamOffers = new Map<number, { id: string; name: string; ico: Uint8Array }>();
  private toneReader: ((file: string, version?: string) => IconTone) | undefined;
  /** The saved icons' versions: this state is sent often, so the disk isn't asked for each game every time. */
  private iconFileVersions: ReturnType<typeof iconVersions> | undefined;

  constructor(private readonly options: GameIconsOptions) {
    this.iconDir = path.join(options.userData, "game-icons");
    this.steamIconDir = path.join(options.userData, "steam-icons");
    this.steamDir = options.steamDir ?? findSteamDir;
  }

  private get library(): Library {
    return this.options.library;
  }

  /** Looks for game icons unless that is already going on, off, or switched off for this run. */
  lookSoon(): void {
    if (!this.library.steamIcons || this.options.steamIcons === "off") return;
    if (this.iconsRunning) {
      // A game was added just as the last run was ending: go round once more.
      this.iconsAgain = true;
      return;
    }
    this.iconsRunning = true;
    void this.findIcons().finally(() => {
      this.iconsRunning = false;
      if (this.iconsAgain) {
        this.iconsAgain = false;
        this.lookSoon();
      }
    });
  }

  /** How a workspace's icon shows: its picture or letters, its game's own icon, and the icon it could offer. */
  view(workspace: WorkspaceEntry): IconView {
    const file = this.shareableFile(workspace);
    return {
      icon: workspace.icon.kind === "image" ? { kind: "image", url: ICON_URL + workspace.icon.file } : workspace.icon,
      ...this.ownIcon(workspace),
      iconChoice: workspace.icon.kind === "image" ? "image" : workspace.useOriginalIcon ? "original" : "letters",
      shareIcon: file ? STEAM_ICON_URL + file : null,
    };
  }

  /** Copies a picture the user picked into Tavora's icons for this workspace; `choose` it once the folder is remembered. Answers with its file. */
  importImage(workspaceId: string, source: string): Promise<string> {
    return importIcon(this.iconDir, workspaceId, source);
  }

  /** Changes the icon the user picked for a workspace, and removes the picture it replaced. */
  async choose(workspaceId: string, choice: IconChoice): Promise<void> {
    const previous =
      choice.kind === "label"
        ? setWorkspaceLabel(this.library, workspaceId, choice.label)
        : choice.kind === "original"
          ? useOriginalWorkspaceIcon(this.library, workspaceId)
          : setWorkspaceImage(this.library, workspaceId, choice.file);
    await this.dropImage(previous);
  }

  /** Removes the icons of a workspace that left the library for good: its picture, and its game's icon unless another game uses that file. */
  async forget(workspace: WorkspaceEntry): Promise<void> {
    await this.dropImage(workspace.icon);
    if (workspace.iconFile && !iconFileShared(this.library, workspace.iconFile, workspace.id)) await removeSteamIcon(this.steamIconDir, workspace.iconFile);
  }

  /**
   * The games installed on this PC for the Add a game list: recently played first, with their icons. Steam's own
   * last-played times, the times Tavora saw a game running and the install dates are only read here and go nowhere.
   */
  async installedGames(): Promise<InstalledGameView[]> {
    const steamDir = this.options.testInstalled ? null : await this.steamDir();
    const [found, steamPlayed, seen] = await Promise.all([
      (this.options.testInstalled ? Promise.resolve(this.options.testInstalled) : findInstalledGames({ steamDir })).then(withInstallDates),
      steamDir ? readSteamLastPlayed(steamDir) : Promise.resolve(new Map<number, number>()),
      this.options.seen(),
    ]);
    const picks = pickGames(found, { steamPlayed, seen });
    // A game whose only copy is in Trash counts as not added: picking it brings that copy back.
    const copyOf = gameCopyFinder(this.library);
    const clientIcons = await this.pickerClientIcons(steamDir, picks.map((pick) => pick.steamAppId).filter((id): id is number => id !== null));
    const views: InstalledGameView[] = [];
    for (let at = 0; at < picks.length; at += 8) {
      views.push(
        ...(await Promise.all(
          picks.slice(at, at + 8).map(async (pick) => {
            if (!this.pickerIcons.has(pick.key)) {
              let icon: string | null = null;
              try {
                const hash = pick.steamAppId === null ? undefined : clientIcons.get(pick.steamAppId);
                const fromSteam = steamDir && hash ? await readSteamClientIcon(steamDir, hash) : null;
                const ico = fromSteam ?? (await readIcoFromFile(pick.source.file, pick.source.index));
                const frame = ico && icoFrameNear(ico, 48);
                if (frame) icon = `data:image/x-icon;base64,${Buffer.from(frame).toString("base64")}`;
              } catch {
                // No icon is fine: the list draws the initials tile.
              }
              this.pickerIcons.set(pick.key, icon);
            }
            const copy = copyOf({ id: pick.catalogId, steamAppId: pick.steamAppId, name: pick.name });
            const workspaceId = copy && copy.trashedAt === null ? copy.id : null;
            return { key: pick.key, name: pick.name, steamAppId: pick.steamAppId, catalogId: pick.catalogId, icon: this.pickerIcons.get(pick.key) ?? null, activity: pick.activity, workspaceId };
          }),
        )),
      );
    }
    return views;
  }

  /** The Add a game covers for these Steam app ids, read once each. */
  covers(appids: number[]): Promise<Record<number, string | null>> {
    return this.pickerCovers(appids);
  }

  /** The games of a Steam look-up, kept so their icons can be offered without adding them. Icons found for an earlier one are dropped. */
  steamLookedUp(games: SteamImportGame[]): void {
    this.steamLookup = games;
    this.steamOffers.clear();
  }

  /**
   * Of these games from the last Steam look-up, the ones the user does not have whose icon Tavora
   * lacks and the Steam client on this PC keeps (named by its appinfo or the game's Steam shortcut).
   * Only files already on this PC are read; nothing is downloaded and nothing is added to the library.
   */
  async steamShareIcons(appids: number[]): Promise<SteamShareResult> {
    const say = (key: MessageKey) => ({ status: "error" as const, error: translate(this.options.language(), key) });
    if (!this.library.onlineSearch) return say("error.onlineOff");
    if (!this.library.steamIcons || this.options.steamIcons === "off") return say("error.steam.iconsOff");
    const list = await this.loadHostedList();
    if (!list) return say("error.unreachable");
    const steamDir = await this.steamDir();
    if (steamDir === null) return say("error.steam.notInstalled");
    const wanted = new Set(appids);
    const copyOf = gameCopyFinder(this.library);
    const games = steamShareGames(
      this.steamLookup.filter((game) => wanted.has(game.appid)),
      (game) => steamGameStatus(this.library, game, copyOf) === "new",
      this.library.iconsOffered,
      list,
    );
    const appInfo = await loadAppInfo(steamDir);
    let clientIcons = new Map<number, string>();
    try {
      if (appInfo) clientIcons = readClientIcons(appInfo, new Set(games.map((game) => game.appid)));
    } catch (error) {
      if (!(error instanceof AppInfoError)) throw error;
    }
    const shortcuts = await readShortcutIcons(this.steamShortcutDirs()).catch(() => new Map<number, string[]>());
    const views: SteamShareView[] = [];
    for (const game of games) {
      const hashes = [clientIcons.get(game.appid), ...(shortcuts.get(game.appid) ?? [])].filter((hash): hash is string => hash !== undefined);
      for (const hash of hashes) {
        const ico = await readSteamClientIcon(steamDir, hash);
        const preview = ico && icoFrameNear(ico, 48);
        if (!ico || !preview) continue;
        this.steamOffers.set(game.appid, { id: game.id, name: game.name, ico });
        views.push({ appid: game.appid, name: game.name, icon: `data:image/x-icon;base64,${Buffer.from(preview).toString("base64")}` });
        break;
      }
    }
    return { status: "ok", games: views.sort((a, b) => a.name.localeCompare(b.name)) };
  }

  /** Offers these games' icons to the service, one at a time. Returns how many it took. */
  share(workspaceIds: string[]): Promise<ActionResult> {
    const offers = workspaceIds.flatMap((id) => {
      const workspace = this.library.workspaces[id];
      const file = workspace ? this.shareableFile(workspace) : null;
      if (!workspace || !file) return [];
      return [
        {
          id: workspace.id,
          name: workspace.name,
          source: shareSource(file),
          read: async () => largestIcoFrame(new Uint8Array(await readFile(path.join(this.steamIconDir, file)))),
          done: () => markIconShared(this.library, workspace.id, new Date()),
        },
      ];
    });
    return this.sendOffers(offers);
  }

  /** Offers the icons of games from the Steam import that are not in the library, as steamShareIcons found them. */
  shareSteam(appids: number[]): Promise<ActionResult> {
    const offers = appids.flatMap((appid) => {
      const offer = this.steamOffers.get(appid);
      // Added or offered since the dialog asked: the library flow or nobody offers it now.
      if (!offer || this.library.iconsOffered.includes(offer.id) || this.library.workspaces[offer.id]) return [];
      return [
        {
          id: offer.id,
          name: offer.name,
          source: "steam" as const,
          read: async () => offer.ico,
          done: () => {
            markIconOffered(this.library, offer.id);
            this.steamOffers.delete(appid);
          },
        },
      ];
    });
    return this.sendOffers(offers);
  }

  /**
   * Finds, one game at a time, the icon of every game that has none yet: from
   * the installed game itself, then from the Steam client on this PC (or Steam's
   * public address), then the icons the Tavora service hosts, then Steam's small
   * public icon. This app does it itself. Quiet on purpose: a failure is tried
   * again at the next start or the next added game, and nothing is shown.
   */
  private async findIcons(): Promise<void> {
    try {
      await syncIcons({
        library: this.library,
        iconDir: this.steamIconDir,
        steamDir: await this.steamDir(),
        baseUrl: this.options.steamIcons,
        serviceUrl: this.options.apiUrl,
        shortcutDirs: this.steamShortcutDirs(),
        loadHostedList: () => this.loadHostedList(),
        shouldRun: this.options.shouldRun,
        ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
        onChange: () => {
          this.iconFileVersions?.forget();
          this.options.saveLibrary();
          this.options.pushState();
        },
      });
      // Games that have their own icon never reached the list: look at it now, to know which ones the service lacks.
      if (this.shareCandidates().length > 0) await this.loadHostedList();
    } catch (error) {
      console.error("[tavora] finding game icons failed", error);
    }
  }

  /** Where Steam's shortcuts are, with the Desktop where Windows says it is (OneDrive can move it). */
  private steamShortcutDirs(): string[] {
    return shortcutFolders(process.env, this.options.desktop());
  }

  private loadHostedList(): Promise<HostedList | null> {
    if (!this.library.onlineSearch || this.options.steamIcons === "off") return Promise.resolve(null);
    if (this.hostedList) return Promise.resolve(this.hostedList);
    this.hostedListLoading ??= fetchHostedList({ baseUrl: serviceUrl(this.options.apiUrl), ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}) }).then((list) => {
      this.hostedList = list;
      this.hostedListLoading = null;
      if (list) this.options.pushState();
      return list;
    });
    return this.hostedListLoading;
  }

  /**
   * The icon file of a game that could be offered: the game's own icon found on
   * this PC (never a picture the user chose, a hosted icon or Steam's small one),
   * for a game with an id the service knows, that the service has no icon for and
   * that was not offered before. Null otherwise.
   */
  private shareableFile(game: WorkspaceEntry): string | null {
    return shareableIconFile(game, this.library, this.hostedList);
  }

  /** Games that have an icon of their own and an id the service knows: the ones worth asking the list about. */
  private shareCandidates(): WorkspaceEntry[] {
    const library = this.library;
    if (!library.steamIcons || !library.onlineSearch) return [];
    return Object.values(library.workspaces).filter(isShareCandidate);
  }

  private async sendOffers(
    offers: { id: string; name: string; source: "installed" | "steam"; read: () => Promise<Uint8Array | null>; done: () => void }[],
  ): Promise<ActionResult> {
    const language = this.options.language();
    // Only signed-in users can share: the service keeps the account with an offer until it is checked.
    const token = this.options.token();
    if (offers.length > 0 && token === null) return { ok: false, error: translate(language, "error.share.signIn") };
    let tried = 0;
    let shared = 0;
    let unreachable = false;
    let limited = false;
    let signedOut = false;
    for (const offer of offers) {
      tried += 1;
      const ico = await offer.read().catch(() => null);
      if (!ico) continue;
      const outcome = await submitIcon(
        { baseUrl: serviceUrl(this.options.apiUrl), token: token!, ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}) },
        { id: offer.id, name: offer.name, source: offer.source, ico },
      );
      if (outcome === "signed-out") {
        signedOut = true;
        break;
      }
      if (outcome === "failed") {
        unreachable = true;
        break;
      }
      if (outcome === "busy") {
        limited = true;
        break;
      }
      // Sent, or refused for good: either way it is not offered again.
      offer.done();
      if (outcome === "sent") shared += 1;
      this.options.saveLibrary();
      this.options.pushState();
      await new Promise((resolve) => setTimeout(resolve, this.options.offerPauseMs ?? 300));
    }
    if (tried === 0) return { ok: false, error: translate(language, "error.nothingToShare") };
    if (signedOut) {
      // Signed out on another PC, or the account is gone: the account side finds out and forgets the sign-in.
      this.options.signedOut();
      if (shared === 0) return { ok: false, error: translate(language, "error.share.signIn") };
    }
    if (limited && shared === 0) return { ok: false, error: translate(language, "error.share.limited") };
    if (unreachable && shared === 0) return { ok: false, error: translate(language, "error.unreachable") };
    return limited ? { ok: true, shared, limited: true } : { ok: true, shared };
  }

  /** Steam's own icon file names for these games, from the client's appinfo; empty when it cannot be read. */
  private async pickerClientIcons(steamDir: string | null, appids: number[]): Promise<Map<number, string>> {
    if (!steamDir || !appids.length) return new Map();
    try {
      const appInfo = await loadAppInfo(steamDir);
      return appInfo ? readClientIcons(appInfo, new Set(appids)) : new Map();
    } catch {
      return new Map();
    }
  }

  /** A game workspace's own icon (its game's) as an address, with the version of its file so a replaced file shows at once, and how it sits in its tile. */
  private ownIcon(workspace: WorkspaceEntry): { steamIcon: string | null; steamIconTone: IconTone | null } {
    if (!(this.library.steamIcons && workspace.useOriginalIcon && workspace.iconFile)) return { steamIcon: null, steamIconTone: null };
    const dir = this.steamIconDir;
    const version = (this.iconFileVersions ??= iconVersions(dir)).of(workspace.iconFile);
    return {
      steamIcon: `${STEAM_ICON_URL}${workspace.iconFile}?v=${version}`,
      steamIconTone: (this.toneReader ??= createToneReader(dir, this.options.smallBitmap))(workspace.iconFile, version),
    };
  }

  private async dropImage(icon: WorkspaceIcon | null): Promise<void> {
    if (icon?.kind === "image") await removeIcon(this.iconDir, icon.file);
  }
}
