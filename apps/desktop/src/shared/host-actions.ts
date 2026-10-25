/**
 * Every action the host UI can ask the main process to do, each with its fields
 * and how they are checked, in one place. The HostAction type comes from this
 * table, so the type and the check cannot drift apart; main/actions.ts parses
 * with it and main/host.ts must handle every kind it lists.
 *
 * Checks that need the main process (ids from @tavora/module-schema, limits of
 * main-only modules) come in as HostChecks, so the host UI can import the type.
 */
import type {
  AiProvider,
  BrowserCommand,
  DeveloperLink,
  GameStart,
  ModuleConnector,
  OnlineGame,
  SavedLayout,
  SteamImportGame,
} from "./host-api";
import { isLanguageSetting, type LanguageSetting } from "./i18n";
import { GRID_LIMITS, layoutTemplate, type LayoutTemplateId } from "./layout-templates";

const BAD: unique symbol = Symbol("bad");
type Bad = typeof BAD;

/** Checks one field of an action: the value the action carries, or BAD. Undefined leaves the field out. */
export type Field<T> = (value: unknown) => T | Bad;

/** The checks only the main process can make. */
export interface HostChecks {
  gameId: Field<string>;
  moduleId: Field<string>;
  ownerId: Field<string>;
  panelType: Field<string>;
  /** A panel, folder, snapshot or AI usage account id. */
  uuid: Field<string>;
  site: Field<string>;
  address: Field<string>;
  steamAppId: Field<number>;
  steamGame: Field<SteamImportGame>;
  variationId: Field<string>;
  gameStart: Field<GameStart>;
  layout: Field<SavedLayout>;
  networkHosts: Field<string[]>;
  connector: Field<ModuleConnector>;
  snapshotName: Field<string>;
  profileName: Field<string>;
  initials: Field<string>;
  /** A cropped 256 px PNG, base64-encoded. */
  picture: Field<string>;
  maxImportGames: number;
}

// ── Fields ───────────────────────────────────────────────────────────

/** A field that passes as it is when the test says yes. */
export const check =
  <T>(test: (value: unknown) => boolean): Field<T> =>
  (value) =>
    test(value) ? (value as T) : BAD;

/** A field read by a parser that answers null for anything malformed. */
export const parsed =
  <T>(parse: (value: unknown) => T | null): Field<T> =>
  (value) =>
    parse(value) ?? BAD;

const text = (max = 200) => check<string>((value) => typeof value === "string" && value.length <= max);
const filled = (max: number) => check<string>((value) => typeof value === "string" && value.length > 0 && value.length <= max);
const named = (max: number) => check<string>((value) => typeof value === "string" && value.trim() !== "" && value.length <= max);
const matching = (pattern: RegExp) => check<string>((value) => typeof value === "string" && pattern.test(value));
const bool = check<boolean>((value) => typeof value === "boolean");
const oneOf = <const V extends readonly string[]>(...values: V) => check<V[number]>((value) => values.includes(value as string));
const optional =
  <T>(field: Field<T>): Field<T | undefined> =>
  (value) =>
    value === undefined ? undefined : field(value);
const nullable =
  <T>(field: Field<T>): Field<T | null> =>
  (value) =>
    value === null ? null : field(value);
const list =
  <T>(item: Field<T>, { min = 0, max, unique = false }: { min?: number; max: number; unique?: boolean }): Field<T[]> =>
  (value) => {
    if (!Array.isArray(value) || value.length < min || value.length > max) return BAD;
    if (unique && new Set(value).size !== value.length) return BAD;
    const items: T[] = [];
    for (const raw of value) {
      const checked = item(raw);
      if (checked === BAD) return BAD;
      items.push(checked);
    }
    return items;
  };

/** A whole number from 1 to max. */
const count = (max: number) => check<number>((value) => Number.isInteger(value) && (value as number) >= 1 && (value as number) <= max);
const layoutTemplateId: Field<LayoutTemplateId> = (value) => (typeof value === "string" ? (layoutTemplate(value)?.id ?? BAD) : BAD);
/** A place in a list. */
const position = check<number>((value) => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 10_000);
const label = nullable(text(16));
const code = matching(/^\d{6}$/);
const fingerprint = matching(/^[0-9a-f]{32}$/);
const deviceId = matching(/^[A-Za-z0-9_-]{1,40}$/);
/** A review or reply: at most 500 characters, which the service counts; here only a cap on its length. Null for none. */
const reviewText = nullable(text(2000));
const reviewId = matching(/^[A-Za-z0-9_-]{16}$/);

/** Most icons offered in one action; the dialog sends more in turns. */
export const MAX_SHARE_BATCH = 50;

const BROWSER_COMMANDS = ["back", "forward", "reload", "stop", "open-external", "mute", "unmute", "exit-fullscreen"] as const satisfies readonly BrowserCommand[];
const DEVELOPER_LINKS = ["docs", "discussions", "issue"] as const satisfies readonly DeveloperLink[];
const AI_PROVIDERS = ["claude", "codex"] as const satisfies readonly AiProvider[];

// ── Actions ──────────────────────────────────────────────────────────

/** The fields of one action; a list holds the ways an action can come (the first that fits wins). */
type Shape = Record<string, Field<unknown>>;
type Spec = Shape | readonly Shape[];
const variants = <const S extends readonly Shape[]>(...shapes: S): S => shapes;

export function hostActionTable(c: HostChecks) {
  const games = (max: number) => list(c.gameId, { min: 1, max, unique: true });
  /** Most games one action may move to Trash, restore or delete; as many as a Steam import adds. */
  const bulkGames = games(c.maxImportGames);
  const onlineGame: Field<OnlineGame> = (value) => {
    if (typeof value !== "object" || value === null) return BAD;
    const game = value as Record<string, unknown>;
    if (!Object.keys(game).every((key) => key === "id" || key === "name" || key === "steamAppId")) return BAD;
    const id = c.gameId(game.id);
    const name = text()(game.name);
    const steamAppId = game.steamAppId === undefined || game.steamAppId === null ? null : c.steamAppId(game.steamAppId);
    return id === BAD || name === BAD || steamAppId === BAD ? BAD : { id, name, steamAppId };
  };

  return {
    // Answers to questions on screen
    "show-welcome": {},
    /** The answer to pendingLink: a new Browser panel, the system browser, or nothing. */
    "link-choice": { choice: oneOf("panel", "system", "cancel") },
    /** The answer to pendingNavigation: open the content in a new panel, or leave it. */
    "navigation-choice": { choice: oneOf("new-panel", "cancel") },
    /** The answer to pendingGameSwitch: switch to the game, or stay. */
    "game-switch": { choice: oneOf("switch", "cancel") },

    // App
    /** Opens the system dialog to pick the place for the pictures of modules, then moves them there. */
    "module-files-change": {},
    /** Moves the pictures of modules back to the default folder. */
    "module-files-reset": {},
    "module-files-open": {},
    restart: {},
    /** Starts the download of a version that was found while automatic download is off. */
    "download-update": {},
    /** Asks the update server now, without waiting for the next scheduled check. */
    "check-for-updates": {},
    /** Quits, installs the downloaded version and starts Tavora again. */
    "restart-to-update": {},
    /** How long the screen took to show something the player asked for, measured where it is drawn. */
    "record-timing": {
      name: oneOf("game-switch"),
      ms: check<number>((value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 600_000),
    },
    /** Puts the version, system, timings, update log and last errors on the clipboard, to paste to whoever is helping. */
    "copy-diagnostics": {},
    /** Opens the folder with the daily copies of the player's data. */
    "open-backups": {},

    // Library
    "open-game": { gameId: c.gameId },
    "add-game": variants(
      { catalogId: c.gameId },
      { name: text() },
      { workspace: text() },
      /** A game found by the online search. */
      { online: onlineGame },
    ),
    "rename-game": { gameId: c.gameId, name: text() },
    "set-game-label": { gameId: c.gameId, label },
    "choose-game-image": { gameId: c.gameId },
    "use-original-icon": { gameId: c.gameId },
    "share-icons": { gameIds: games(MAX_SHARE_BATCH) },
    /** Offers the icons of games from the last Steam import look-up that are not in the library (prepared by steamShareIcons). */
    "share-steam-icons": { appids: list(c.steamAppId, { min: 1, max: MAX_SHARE_BATCH, unique: true }) },
    /** Adds the chosen games of a Steam library that the player does not have yet. */
    "import-steam-games": { games: list(c.steamGame, { min: 1, max: c.maxImportGames }) },
    "trash-game": { gameId: c.gameId },
    "restore-game": { gameId: c.gameId },
    "delete-game": { gameId: c.gameId },
    /** The same for many games at once, from Settings > Games and Trash. */
    "trash-games": { gameIds: bulkGames },
    "restore-games": { gameIds: bulkGames },
    "delete-games": { gameIds: bulkGames },
    favorite: { gameId: c.gameId, index: optional(position) },
    unfavorite: { gameId: c.gameId },
    "move-game": { gameId: c.gameId, folderId: nullable(c.uuid), index: optional(position) },
    "create-folder": { name: text(), gameIds: list(c.gameId, { max: 1000 }) },
    "rename-folder": { folderId: c.uuid, name: text() },
    "set-folder-label": { folderId: c.uuid, label },
    "delete-folder": { folderId: c.uuid },
    "move-folder": { folderId: c.uuid, index: position },

    // Settings
    "set-sort": { sort: oneOf("recent", "manual") },
    "set-startup": { startup: oneOf("welcome", "last-game") },
    "set-game-start": { gameStart: c.gameStart },
    /** A personal workspace's id, or null to stay on the game. */
    "set-game-end": { workspaceId: nullable(c.gameId) },
    "set-grayscale-text": { enabled: bool },
    "set-online-search": { enabled: bool },
    "set-auto-update": { enabled: bool },
    "set-auto-update-modules": { enabled: bool },
    "set-steam-icons": { enabled: bool },
    "set-module-icons": { enabled: bool },

    // Streaming
    "set-stream-overlays": { enabled: bool },
    /** The port Stream overlays listen on, on this PC only. */
    "set-overlay-port": { port: check<number>((value) => Number.isInteger(value) && (value as number) >= 1024 && (value as number) <= 65535) },
    /** Every overlay link gets a new address; the ones in OBS stop working. */
    "reset-overlay-links": {},
    /** The answer in Tavora's hotkey dialog (HostViewState.hotkeyRequest): a key, removing the one set, or closing it. */
    "hotkey-answer": {
      id: check<number>((value) => Number.isSafeInteger(value)),
      choice: oneOf("set", "remove", "cancel"),
      accelerator: optional(text(40)),
    },
    /** Settings > Overlays: the Game overlays switch. */
    "set-game-overlays": { enabled: bool },
    /** Changes what the player set for one game overlay (mode, opacity, Hide from capture). */
    "set-game-overlay": {
      owner: c.ownerId,
      moduleId: c.moduleId,
      gameId: c.gameId,
      key: matching(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/),
      mode: optional(oneOf("always", "toggle")),
      opacity: optional(check<100 | 75 | 50 | 25>((value) => value === 100 || value === 75 || value === 50 || value === 25)),
      hideFromCapture: optional(bool),
    },
    /** Removes one game overlay, and its key. */
    "remove-game-overlay": { owner: c.ownerId, moduleId: c.moduleId, gameId: c.gameId, key: matching(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/) },
    /** Opens the hotkey dialog for a game's arrange key (without owner, moduleId and key) or for one overlay's toggle key. */
    "set-overlay-key": { gameId: c.gameId, owner: optional(c.ownerId), moduleId: optional(c.moduleId), key: optional(matching(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/)) },
    /** The answer in the consent dialog for a connector a module asks for on request (HostViewState.pendingConnector). */
    "connector-answer": { id: check<number>((value) => Number.isSafeInteger(value)), allow: bool },
    /** Removes one hotkey from Settings > Streaming. */
    "remove-hotkey": { owner: c.ownerId, moduleId: c.moduleId, gameId: c.gameId, action: matching(/^[a-z][a-z0-9-]{0,31}$/), target: matching(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/) },
    "set-language": { language: check<LanguageSetting>(isLanguageSetting) },
    /** Remembers the Steam profile for the import on this PC; null forgets it. */
    "set-steam-profile": { profile: nullable((value) => (typeof value === "string" && value.length <= 200 && value.trim() !== "" ? value.trim() : BAD)) },
    /** Done ends the first-run welcome; false shows it again. */
    "set-onboarded": { done: bool },
    "set-rail": { expanded: optional(bool), width: optional(check<number>((value) => typeof value === "number" && Number.isFinite(value))) },

    // Appearance
    /** `fixed` turns Follow System off; without it the pick keeps following the system. */
    "set-theme": { themeId: c.moduleId, variationId: c.variationId, fixed: optional(bool) },
    /** Follow the system's light or dark setting, or stay in one mode. */
    "set-appearance-mode": { mode: oneOf("system", "dark", "light") },
    /** Back to the Tavora default theme, whatever is active. */
    "reset-theme": {},
    /** Looks for themes again, after the player changed their themes folder. */
    "reload-themes": {},
    /** Opens the player's themes folder in the file manager, creating it first. */
    "open-themes-folder": {},
    /** Copies the Tavora theme into the themes folder as a new theme to change; answers with its id. */
    "create-starter-theme": {},

    // Profile
    // Code units, so emoji still fit; both are clipped by character when stored.
    "save-profile": { name: c.profileName, initials: c.initials },
    "set-profile-picture": { png: c.picture },
    "remove-profile-picture": {},

    // Modules
    /** Opens the player's modules folder in the file manager, creating it first. */
    "open-modules-folder": {},
    /** Opens a folder Settings lists as not loading (a `moduleProblems` path) in the file manager. */
    "open-module-problem-folder": { path: filled(500) },
    /** Picks a module project folder to load from (answers with the folder), or forgets one. */
    "add-development-folder": {},
    "remove-development-folder": { folder: filled(500) },
    /** Copies an example into a new project in a development folder, or in a folder the player picks (null); answers with the new project. */
    "copy-example": { moduleId: c.moduleId, name: named(80), folder: nullable(filled(500)) },
    /** Opens a module project of a development folder (a `developmentFolders` project) in the file manager. */
    "open-development-project": { project: filled(500) },
    /** Opens an example's folder in the file manager, to look at its sources. */
    "open-example-folder": { moduleId: c.moduleId },
    "open-developer-link": { link: oneOf(...DEVELOPER_LINKS) },
    /** Looks for modules again, after the player changed their modules folder. */
    "reload-modules": {},
    /** Moves a module from the player's modules folder to the recycle bin, after removing its panels in every game; its data stays. */
    "remove-module": { moduleId: c.moduleId },
    /** The player's yes in the consent dialog: exactly what it showed (only what the module still asks for is granted). */
    "grant-module": { moduleId: c.moduleId, network: c.networkHosts, connectors: list(c.connector, { max: Infinity, unique: true }) },
    /** Takes back everything granted to a module, after removing its panels in every game; its data stays. */
    "revoke-module": { moduleId: c.moduleId },
    /** Asks for a module zip and installs it into the player's modules folder; answers with the module's id. */
    "install-module": {},
    /** Downloads a module from the catalog, checks it and installs it like a zip. */
    "install-catalog-module": { moduleId: c.moduleId },
    /** Looks for updates of the modules installed from the catalog now; answers with `updated` and `waiting`. */
    "check-module-updates": {},
    /**
     * Reports a catalog module to Tavora after the player pressed Report: the installed zip when it came
     * from the catalog, otherwise the listed one. Sends only the module id, its key and the zip's hash.
     */
    "report-catalog-module": { moduleId: c.moduleId },
    /** Opens a catalog module's homepage like a module link: the address is the one the main process reads from the listing again. */
    "open-catalog-homepage": { moduleId: c.moduleId },
    /**
     * Opens a link from a catalog module's readme like the homepage. The main process reads the readme
     * again and opens the address only when it is one of the readme's http or https links.
     */
    /**
     * Opens a module's support link after a click: a web address like the homepage, an email address in the mail app.
     * The main process reads the link again, from the installed module's manifest (`installed`) or the catalog listing.
     */
    "open-module-support": { moduleId: c.moduleId, source: oneOf("catalog", "installed") },
    "open-readme-link": { moduleId: c.moduleId, url: filled(2000) },
    /** Rates an installed catalog module with the account, on the installed version; `text` is the review, null for stars only. */
    "rate-catalog-module": { moduleId: c.moduleId, stars: count(5), text: reviewText },
    /** Deletes the account's rating of a catalog module. */
    "unrate-catalog-module": { moduleId: c.moduleId },
    /** The publisher's one reply under a review of their module; null takes it back. */
    "reply-catalog-review": { moduleId: c.moduleId, reviewId, text: reviewText },
    /** Reports a review to Tavora after the player pressed Report. Sends only the review's id. */
    "report-catalog-review": { reviewId },
    /** The player said yes to a catalog update that asks for more: installs exactly that version and grants what it asked for. */
    "apply-module-update": { moduleId: c.moduleId, version: filled(64) },
    /** Deletes the data a module that is not installed left behind (owner as in leftoverModuleData). */
    "delete-module-data": { owner: c.ownerId, moduleId: c.moduleId },
    /** Moves a signed module's data from its unsigned local copy to it; Tavora restarts to do it. */
    "move-local-data": { moduleId: c.moduleId },
    /** The player opened a module's patch notes: none of them are new any more. */
    "seen-module-notes": { moduleId: c.moduleId },

    // Panels and workspace
    /**
     * Opens a new panel; `panelType` picks one of the module's panel types (its continuing type when left out).
     * With `reuse`, a panel of that type already open comes to the front instead.
     */
    "open-module": { moduleId: c.moduleId, panelType: optional(c.panelType), reuse: optional(bool) },
    /** Gives a panel whose type an update removed another type of the same module. */
    "choose-panel-type": { instanceId: c.uuid, panelType: c.panelType },
    "close-panel": { instanceId: c.uuid },
    /** Closes all of a module's panels in the current game, leaving empty slots; it stays installed. */
    "remove-module-from-game": { moduleId: c.moduleId },
    "reload-panel": { instanceId: c.uuid },
    "stop-panel": { instanceId: c.uuid },
    /** Null when nothing is docked any more. */
    "save-layout": { layout: nullable(c.layout) },
    /** Rearranges the workspace into empty slots of a layout template; open panels fill the first ones. */
    "apply-layout-template": { templateId: layoutTemplateId },
    /** The same, for an even grid (at most GRID_LIMITS). */
    "apply-layout-grid": { columns: count(GRID_LIMITS.columns), rows: count(GRID_LIMITS.rows) },
    "save-snapshot": { name: c.snapshotName },
    "update-snapshot": { snapshotId: c.uuid },
    "apply-snapshot": { snapshotId: c.uuid },
    "rename-snapshot": { snapshotId: c.uuid, name: c.snapshotName },
    "delete-snapshot": { snapshotId: c.uuid },

    // Browser panels
    /** An empty Browser tab beside this one. */
    "browser-new-tab": { instanceId: c.uuid },
    /** What the player typed in a Browser panel's address bar. */
    "browser-navigate": { instanceId: c.uuid, address: c.address },
    "browser-command": { instanceId: c.uuid, command: oneOf(...BROWSER_COMMANDS) },
    /** Signs the page's site in for all games (true) or for each game on its own. */
    "browser-set-shared": { instanceId: c.uuid, shared: bool },
    "browser-set-adblock": { instanceId: c.uuid, enabled: bool },
    /** Removes a site from one of the lists in Settings > Browser. */
    "browser-forget-site": { list: oneOf("shared", "adblock-off"), site: c.site },
    /** Deletes cookies, logins and caches: the current game's, or the ones shared by all games. */
    "clear-browser-data": { scope: oneOf("game", "shared") },

    // Discord and AI usage
    /** Connects to the Discord app, asking for approval in Discord if Tavora was never approved. */
    "discord-connect": {},
    /** Forgets Tavora's Discord sign-in on this PC. */
    "discord-sign-out": {},
    /** Adds an account for a CLI profile folder. */
    "ai-usage-add": { provider: oneOf(...AI_PROVIDERS), label: text(60), directory: text(500) },
    /** Renames an account or points it at another profile folder. */
    "ai-usage-update": { accountId: c.uuid, label: text(60), directory: text(500) },
    "ai-usage-remove": { accountId: c.uuid },

    // Account
    /** Mails a sign-in code to an address. */
    "account-send-code": { email: text(254) },
    /** The code typed in; for an address without an account the view then asks to create one. */
    "account-verify": { code },
    /** Yes to "Create a Tavora account", with the age tick box (an account is only made when it is ticked). */
    "account-create": { ageConfirmed: bool },
    /** Leaves a waiting code (sign-in, email change or delete). */
    "account-cancel": {},
    /** Reads the account and its devices from the service again. */
    "account-refresh": {},
    "account-sign-out": {},
    "account-sign-out-device": { deviceId },
    "account-rename-device": { deviceId, name: named(40) },
    "account-email-code": { email: text(254) },
    "account-change-email": { code },
    "account-delete-code": {},
    "account-delete": { code },
    /** Discord login in the browser: sign in (or create), connect to the signed-in account, disconnect. */
    "account-discord-sign-in": {},
    "account-discord-connect-code": {},
    "account-discord-connect": { code },
    "account-discord-disconnect-code": {},
    "account-discord-disconnect": { code },
    "account-email-remove-code": {},
    "account-email-remove": { code },
    /** Deletes the account by a fresh Discord sign-in (an account without an email address). */
    "account-delete-discord": {},
    /** The answer to "Which profile?" on a first sign-in. */
    "account-profile-choice": { keep: oneOf("account", "pc") },

    // Developer side of the account
    /** The public name, a code to link a publisher key, and unlinking one. */
    "account-developer-name": { name: named(32) },
    "account-link-code": {},
    /** Copies `tavora-pack link <code>` for the code shown now. */
    "account-copy-link-command": {},
    "account-unlink-key": { fingerprint },
    /** "I lost this key" or "It was leaked": its modules move to another key of the account once Tavora signs it. */
    "account-replace-key": { fingerprint, leaked: bool },
    /** Publish tokens, for publishing from CI: make one (its secret shown once), copy it, close it, remove one. */
    "account-publish-token-create": { name: check<string>((value) => typeof value === "string" && value.trim() !== "" && value.trim().length <= 40) },
    "account-publish-token-copy": {},
    "account-publish-token-saved": {},
    "account-publish-token-delete": { id: text(40) },
    "developer-key-create": {},
    "developer-key-add": {},
    "developer-key-export": { fingerprint },
    "developer-key-link": { fingerprint },
    "developer-recovery-key": { key: text() },
    "developer-recovery-key-saved": {},
    "developer-show-recovery-key": {},
    "developer-copy-recovery-key": {},
    /** Asks the catalog about an id prefix, or claims it for the account (the account view's prefixCheck says what it said). */
    "account-prefix-check": { prefix: filled(126) },
    "account-prefix-claim": { prefix: filled(126) },
    /** Opens the review screen for a module from a project folder, or packs it again. */
    "publish-review": { moduleId: c.moduleId },
    "publish-refresh": {},
    /** Writes a version and its patch notes into the reviewed project's files, then packs again. */
    "publish-write": { version: matching(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/), notes: list(text(500), { max: 20 }) },
    /** Gives the reviewed module a new id in its project files (before its first publish), then packs again. */
    "publish-set-id": { id: c.moduleId },
    /** Uploads the zip the review screen shows to the catalog. */
    "publish-upload": {},
    "publish-close": {},
    /** Copies `npm create @tavora/module`, the command that starts a module project. */
    "developer-copy-create-command": {},
    /** Packs a module from a project folder, signed with a kept key, and saves the zip where the developer picks. */
    "save-module-zip": { moduleId: c.moduleId },
    /** Asks another PC of the account for its key, instead of typing the recovery key. */
    "pairing-start": {},
    "pairing-cancel": {},
    /** The player's answer to "Add <PC>?". */
    "pairing-decide": { id: matching(/^[A-Za-z0-9_-]{16}$/), allow: bool },

    // Cloud copy (Settings > Account). Turning on makes a key, or asks for the one of a copy that exists.
    "cloud-copy-on": {},
    /** Turns the copy on in a folder the player picks in the system's dialog. */
    "cloud-copy-on-folder": {},
    /** Moves the copy, keeping its key: to the service, or to a folder the player picks in the system's dialog. */
    "cloud-copy-move": { to: oneOf("server", "folder") },
    "cloud-copy-key": { key: text() },
    "cloud-copy-cancel": {},
    /** Lost the recovery key: the copy is deleted and the account gets a new key. */
    "cloud-copy-new-key": {},
    "cloud-copy-show-key": {},
    /** Puts the recovery key on screen on the clipboard. */
    "cloud-copy-copy-key": {},
    /** The player saved the recovery key: it leaves the screen. */
    "cloud-copy-key-saved": {},
    "cloud-copy-upload": {},
    /** Takes the copy in place of this PC's data (kept as a local backup); Tavora restarts. */
    "cloud-copy-restore": {},
    /** Both sides changed: keep this PC's (the copy is kept as a local backup) or the copy's. */
    "cloud-copy-keep": { side: oneOf("pc", "cloud") },
    "cloud-copy-restart": {},
    /** Off on this PC; the copy stays for the other PCs. */
    "cloud-copy-off": {},
    "cloud-copy-delete": {},
    "cloud-copy-close-anyway": {},
  } satisfies Record<string, Spec>;
}

type HostActionTable = ReturnType<typeof hostActionTable>;
type FieldValue<F> = F extends Field<infer T> ? T : never;
type Optional<S> = { [K in keyof S]: undefined extends FieldValue<S[K]> ? K : never }[keyof S];
type ShapeValue<S> = { [K in Exclude<keyof S, Optional<S>>]: FieldValue<S[K]> } & { [K in Optional<S>]?: Exclude<FieldValue<S[K]>, undefined> };
type SpecValue<S> = S extends readonly (infer V)[] ? (V extends unknown ? ShapeValue<V> : never) : ShapeValue<S>;
type Flat<T> = { [K in keyof T]: T[K] } & {};
type ActionOf<K extends keyof HostActionTable> = SpecValue<HostActionTable[K]> extends infer V ? (V extends unknown ? Flat<{ type: K } & V> : never) : never;

/** Everything the host UI can ask the main process to do. Parsed strictly in main. */
export type HostAction = { [K in keyof HostActionTable]: ActionOf<K> }[keyof HostActionTable];
export type HostActionType = HostAction["type"];

function parseShape(shape: Shape, fields: Record<string, unknown>): Record<string, unknown> | null {
  if (!Object.keys(fields).every((key) => key === "type" || Object.hasOwn(shape, key))) return null;
  const parsed: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(shape)) {
    const value = field(fields[key]);
    if (value === BAD) return null;
    if (value !== undefined) parsed[key] = value;
  }
  return parsed;
}

/** Checks a message against the table: exactly the fields of its kind, each one valid. Null for anything else. */
export function parseHostAction(table: HostActionTable, raw: unknown): HostAction | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const fields = raw as Record<string, unknown>;
  const type = fields.type;
  if (typeof type !== "string" || !Object.hasOwn(table, type)) return null;
  const spec: Spec = table[type as HostActionType];
  for (const shape of Array.isArray(spec) ? spec : [spec]) {
    const parsed = parseShape(shape as Shape, fields);
    if (parsed) return { type, ...parsed } as HostAction;
  }
  return null;
}
