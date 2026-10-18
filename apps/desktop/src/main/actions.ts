import { isConnector, isGameId, isModuleId, isNetworkHost, isOwnerId, isPanelTypeId, MAX_NETWORK_HOSTS, type Connector } from "@tavora/module-schema";
import type { BrowserCommand, HostAction, SteamImportGame } from "../shared/host-api";
import { isSite, MAX_ADDRESS } from "./browser-url";
import { INSTANCE_ID } from "./ids";
import { parseLayout } from "./layout";
import { isGridSize, layoutTemplate } from "../shared/layout-templates";
import { MAX_INITIALS, MAX_PICTURE_BYTES, MAX_PROFILE_NAME } from "./profile";
import { isLanguageSetting } from "../shared/i18n";
import { isSteamAppId } from "./steam-icons";
import { MAX_IMPORT_GAMES, parseSteamGame } from "./steam-import";
import { isVariationId } from "./themes";
import { MAX_SNAPSHOT_NAME } from "./workspace";

export type { ActionResult, HostAction } from "../shared/host-api";

type Fields = Record<string, unknown>;

const text = (value: unknown, max = 200): value is string => typeof value === "string" && value.length <= max;
const label = (value: unknown): value is string | null => value === null || text(value, 16);
const index = (value: unknown): value is number | undefined =>
  value === undefined || (Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 10_000);
const uuid = (value: unknown): value is string => typeof value === "string" && INSTANCE_ID.test(value);
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
/** Most icons offered in one action; the dialog sends more in turns. */
export const MAX_SHARE_BATCH = 50;
/** Most games one action may move to Trash, restore or delete; as many as a Steam import adds. */
export const MAX_BULK_GAMES = MAX_IMPORT_GAMES;
const BROWSER_COMMANDS: readonly BrowserCommand[] = ["back", "forward", "reload", "stop", "open-external", "mute", "unmute", "exit-fullscreen"];

/**
 * Checks a message from the host UI. The host UI is trusted code, but its
 * messages are still parsed strictly: a bug there must not be able to write
 * arbitrary data into the library. Returns null for anything malformed.
 */
export function parseAction(raw: unknown): HostAction | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const a = raw as Fields;
  const only = (...keys: string[]) => Object.keys(a).every((key) => key === "type" || keys.includes(key));

  switch (a.type) {
    case "module-files-change":
    case "module-files-reset":
    case "module-files-open":
      return only() ? { type: a.type } : null;
    case "link-choice":
      return only("choice") && (a.choice === "panel" || a.choice === "system" || a.choice === "cancel") ? { type: "link-choice", choice: a.choice } : null;
    case "navigation-choice":
      return only("choice") && (a.choice === "new-panel" || a.choice === "cancel") ? { type: "navigation-choice", choice: a.choice } : null;
    case "show-welcome":
    case "restart":
    case "download-update":
    case "open-backups":
    case "copy-diagnostics":
    case "check-for-updates":
    case "restart-to-update":
    case "reset-theme":
    case "reload-themes":
    case "open-themes-folder":
    case "create-starter-theme":
    case "open-modules-folder":
    case "reload-modules":
    case "install-module":
    case "add-development-folder":
      return only() ? { type: a.type } : null;
    case "remove-development-folder":
      return only("folder") && typeof a.folder === "string" && a.folder.length > 0 && a.folder.length <= 500 ? { type: a.type, folder: a.folder } : null;
    case "install-catalog-module":
    case "remove-module":
    case "seen-module-notes":
    case "move-local-data":
    case "revoke-module":
      return only("moduleId") && isModuleId(a.moduleId) ? { type: a.type, moduleId: a.moduleId } : null;
    case "grant-module":
      return only("moduleId", "network", "connectors") &&
        isModuleId(a.moduleId) &&
        Array.isArray(a.network) &&
        a.network.length <= MAX_NETWORK_HOSTS &&
        a.network.every(isNetworkHost) &&
        new Set(a.network).size === a.network.length &&
        Array.isArray(a.connectors) &&
        a.connectors.every(isConnector) &&
        new Set(a.connectors).size === a.connectors.length
        ? { type: a.type, moduleId: a.moduleId, network: [...(a.network as string[])], connectors: [...(a.connectors as Connector[])] }
        : null;
    case "delete-module-data":
      return only("owner", "moduleId") && isOwnerId(a.owner) && isModuleId(a.moduleId) ? { type: a.type, owner: a.owner, moduleId: a.moduleId } : null;
    case "record-timing":
      return only("name", "ms") && a.name === "game-switch" && typeof a.ms === "number" && Number.isFinite(a.ms) && a.ms >= 0 && a.ms < 600_000
        ? { type: a.type, name: a.name, ms: a.ms }
        : null;
    case "set-theme":
      return only("themeId", "variationId", "fixed") && isModuleId(a.themeId) && isVariationId(a.variationId) && (a.fixed === undefined || typeof a.fixed === "boolean")
        ? { type: a.type, themeId: a.themeId, variationId: a.variationId, ...(a.fixed === undefined ? {} : { fixed: a.fixed }) }
        : null;
    case "set-appearance-mode":
      return only("mode") && (a.mode === "system" || a.mode === "dark" || a.mode === "light") ? { type: a.type, mode: a.mode } : null;
    case "open-game":
    case "choose-game-image":
    case "use-original-icon":
    case "trash-game":
    case "restore-game":
    case "delete-game":
    case "unfavorite":
      return only("gameId") && isGameId(a.gameId) ? { type: a.type, gameId: a.gameId } : null;
    case "trash-games":
    case "restore-games":
    case "delete-games":
      return only("gameIds") &&
        Array.isArray(a.gameIds) &&
        a.gameIds.length >= 1 &&
        a.gameIds.length <= MAX_BULK_GAMES &&
        a.gameIds.every((id) => isGameId(id)) &&
        new Set(a.gameIds).size === a.gameIds.length
        ? { type: a.type, gameIds: a.gameIds as string[] }
        : null;
    case "share-steam-icons":
      return only("appids") &&
        Array.isArray(a.appids) &&
        a.appids.length >= 1 &&
        a.appids.length <= MAX_SHARE_BATCH &&
        a.appids.every(isSteamAppId) &&
        new Set(a.appids).size === a.appids.length
        ? { type: a.type, appids: a.appids as number[] }
        : null;
    case "share-icons":
      return only("gameIds") &&
        Array.isArray(a.gameIds) &&
        a.gameIds.length >= 1 &&
        a.gameIds.length <= MAX_SHARE_BATCH &&
        a.gameIds.every((id) => isGameId(id)) &&
        new Set(a.gameIds).size === a.gameIds.length
        ? { type: a.type, gameIds: a.gameIds as string[] }
        : null;
    case "import-steam-games": {
      if (!only("games") || !Array.isArray(a.games) || a.games.length < 1 || a.games.length > MAX_IMPORT_GAMES) return null;
      const games: SteamImportGame[] = [];
      for (const raw of a.games) {
        const game = parseSteamGame(raw);
        // Exactly the fields the dialog got from the service, nothing more.
        if (!game || Object.keys(raw as object).some((key) => key !== "appid" && key !== "name" && key !== "id")) return null;
        games.push(game);
      }
      return { type: a.type, games };
    }
    case "add-game":
      if (only("catalogId") && isGameId(a.catalogId)) return { type: a.type, catalogId: a.catalogId };
      if (only("name") && text(a.name)) return { type: a.type, name: a.name };
      if (only("workspace") && text(a.workspace)) return { type: a.type, workspace: a.workspace };
      if (only("online")) {
        const game = a.online as Fields | null;
        if (
          typeof game === "object" &&
          game !== null &&
          Object.keys(game).every((key) => key === "id" || key === "name" || key === "steamAppId") &&
          isGameId(game.id) &&
          text(game.name) &&
          (game.steamAppId === undefined || game.steamAppId === null || isSteamAppId(game.steamAppId))
        ) {
          return {
            type: a.type,
            online: { id: game.id, name: game.name, steamAppId: isSteamAppId(game.steamAppId) ? game.steamAppId : null },
          };
        }
      }
      return null;
    case "rename-game":
      return only("gameId", "name") && isGameId(a.gameId) && text(a.name)
        ? { type: a.type, gameId: a.gameId, name: a.name }
        : null;
    case "set-game-label":
      return only("gameId", "label") && isGameId(a.gameId) && label(a.label)
        ? { type: a.type, gameId: a.gameId, label: a.label }
        : null;
    case "favorite":
      return only("gameId", "index") && isGameId(a.gameId) && index(a.index)
        ? { type: a.type, gameId: a.gameId, ...(a.index === undefined ? {} : { index: a.index }) }
        : null;
    case "move-game":
      return only("gameId", "folderId", "index") &&
        isGameId(a.gameId) &&
        (a.folderId === null || uuid(a.folderId)) &&
        index(a.index)
        ? { type: a.type, gameId: a.gameId, folderId: a.folderId, ...(a.index === undefined ? {} : { index: a.index }) }
        : null;
    case "create-folder":
      return only("name", "gameIds") &&
        text(a.name) &&
        Array.isArray(a.gameIds) &&
        a.gameIds.length <= 1000 &&
        a.gameIds.every(isGameId)
        ? { type: a.type, name: a.name, gameIds: a.gameIds }
        : null;
    case "rename-folder":
      return only("folderId", "name") && uuid(a.folderId) && text(a.name)
        ? { type: a.type, folderId: a.folderId, name: a.name }
        : null;
    case "set-folder-label":
      return only("folderId", "label") && uuid(a.folderId) && label(a.label)
        ? { type: a.type, folderId: a.folderId, label: a.label }
        : null;
    case "delete-folder":
      return only("folderId") && uuid(a.folderId) ? { type: a.type, folderId: a.folderId } : null;
    case "move-folder":
      return only("folderId", "index") && uuid(a.folderId) && index(a.index) && a.index !== undefined
        ? { type: a.type, folderId: a.folderId, index: a.index }
        : null;
    case "set-sort":
      return only("sort") && (a.sort === "recent" || a.sort === "manual") ? { type: a.type, sort: a.sort } : null;
    case "set-startup":
      return only("startup") && (a.startup === "welcome" || a.startup === "last-game")
        ? { type: a.type, startup: a.startup }
        : null;
    case "save-profile":
      // Code units, so emoji still fit; both are clipped by character when stored.
      return only("name", "initials") && text(a.name, MAX_PROFILE_NAME * 2) && text(a.initials, MAX_INITIALS * 2)
        ? { type: a.type, name: a.name, initials: a.initials }
        : null;
    case "set-profile-picture":
      return only("png") && text(a.png, Math.ceil(MAX_PICTURE_BYTES / 3) * 4) && BASE64.test(a.png)
        ? { type: a.type, png: a.png }
        : null;
    case "remove-profile-picture":
      return only() ? { type: a.type } : null;
    case "set-grayscale-text":
    case "set-online-search":
    case "set-auto-update":
    case "set-steam-icons":
    case "set-module-icons":
      return only("enabled") && typeof a.enabled === "boolean" ? { type: a.type, enabled: a.enabled } : null;
    case "set-language":
      return only("language") && isLanguageSetting(a.language) ? { type: a.type, language: a.language } : null;
    case "set-steam-profile":
      return only("profile") && (a.profile === null || (text(a.profile, 200) && a.profile.trim() !== ""))
        ? { type: a.type, profile: a.profile === null ? null : a.profile.trim() }
        : null;
    case "set-onboarded":
      return only("done") && typeof a.done === "boolean" ? { type: a.type, done: a.done } : null;
    case "set-rail": {
      if (!only("expanded", "width")) return null;
      if (a.expanded !== undefined && typeof a.expanded !== "boolean") return null;
      if (a.width !== undefined && !(typeof a.width === "number" && Number.isFinite(a.width))) return null;
      return {
        type: a.type,
        ...(a.expanded === undefined ? {} : { expanded: a.expanded as boolean }),
        ...(a.width === undefined ? {} : { width: a.width as number }),
      };
    }
    case "browser-new-tab":
      return only("instanceId") && uuid(a.instanceId) ? { type: a.type, instanceId: a.instanceId } : null;
    case "browser-navigate":
      return only("instanceId", "address") && uuid(a.instanceId) && text(a.address, MAX_ADDRESS) && a.address.trim() !== ""
        ? { type: a.type, instanceId: a.instanceId, address: a.address }
        : null;
    case "browser-command":
      return only("instanceId", "command") && uuid(a.instanceId) && BROWSER_COMMANDS.includes(a.command as BrowserCommand)
        ? { type: a.type, instanceId: a.instanceId, command: a.command as BrowserCommand }
        : null;
    case "browser-set-shared":
      return only("instanceId", "shared") && uuid(a.instanceId) && typeof a.shared === "boolean" ? { type: a.type, instanceId: a.instanceId, shared: a.shared } : null;
    case "browser-set-adblock":
      return only("instanceId", "enabled") && uuid(a.instanceId) && typeof a.enabled === "boolean"
        ? { type: a.type, instanceId: a.instanceId, enabled: a.enabled }
        : null;
    case "browser-forget-site":
      return only("list", "site") && (a.list === "shared" || a.list === "adblock-off") && isSite(a.site) ? { type: a.type, list: a.list, site: a.site } : null;
    case "clear-browser-data":
      return only("scope") && (a.scope === "game" || a.scope === "shared") ? { type: a.type, scope: a.scope } : null;
    case "discord-connect":
    case "discord-sign-out":
      return only() ? { type: a.type } : null;
    case "account-discord-sign-in":
    case "account-discord-connect-code":
    case "account-discord-disconnect-code":
    case "account-email-remove-code":
    case "account-delete-discord":
      return only() ? { type: a.type } : null;
    case "account-create":
      return only("ageConfirmed") && typeof a.ageConfirmed === "boolean" ? { type: a.type, ageConfirmed: a.ageConfirmed } : null;
    case "account-cancel":
    case "account-refresh":
    case "account-sign-out":
    case "account-delete-code":
      return only() ? { type: a.type } : null;
    case "account-send-code":
    case "account-email-code":
      return only("email") && text(a.email, 254) ? { type: a.type, email: a.email } : null;
    case "account-verify":
    case "account-change-email":
    case "account-email-remove":
    case "account-discord-connect":
    case "account-discord-disconnect":
    case "account-delete":
      return only("code") && typeof a.code === "string" && /^\d{6}$/.test(a.code) ? { type: a.type, code: a.code } : null;
    case "account-profile-choice":
      return only("keep") && (a.keep === "account" || a.keep === "pc") ? { type: a.type, keep: a.keep } : null;
    case "account-developer-name":
      return only("name") && typeof a.name === "string" && a.name.trim() !== "" && a.name.length <= 32 ? { type: a.type, name: a.name } : null;
    case "account-link-code":
    case "account-copy-link-command":
      return only() ? { type: a.type } : null;
    case "account-unlink-key":
      return only("fingerprint") && typeof a.fingerprint === "string" && /^[0-9a-f]{32}$/.test(a.fingerprint) ? { type: a.type, fingerprint: a.fingerprint } : null;
    case "account-sign-out-device":
      return only("deviceId") && typeof a.deviceId === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(a.deviceId) ? { type: a.type, deviceId: a.deviceId } : null;
    case "ai-usage-add":
      return only("provider", "label", "directory") && (a.provider === "claude" || a.provider === "codex") && text(a.label, 60) && text(a.directory, 500)
        ? { type: a.type, provider: a.provider, label: a.label, directory: a.directory }
        : null;
    case "ai-usage-update":
      return only("accountId", "label", "directory") && uuid(a.accountId) && text(a.label, 60) && text(a.directory, 500)
        ? { type: a.type, accountId: a.accountId, label: a.label, directory: a.directory }
        : null;
    case "ai-usage-remove":
      return only("accountId") && uuid(a.accountId) ? { type: a.type, accountId: a.accountId } : null;
    case "open-module":
      if (!only("moduleId", "panelType") || !isModuleId(a.moduleId)) return null;
      if (a.panelType === undefined) return { type: a.type, moduleId: a.moduleId };
      return isPanelTypeId(a.panelType) ? { type: a.type, moduleId: a.moduleId, panelType: a.panelType } : null;
    case "choose-panel-type":
      return only("instanceId", "panelType") && uuid(a.instanceId) && isPanelTypeId(a.panelType)
        ? { type: a.type, instanceId: a.instanceId, panelType: a.panelType }
        : null;
    case "close-panel":
    case "reload-panel":
    case "stop-panel":
      return only("instanceId") && uuid(a.instanceId)
        ? { type: a.type, instanceId: a.instanceId }
        : null;
    case "save-layout": {
      if (!only("layout")) return null;
      if (a.layout === null) return { type: a.type, layout: null };
      const layout = parseLayout(a.layout);
      return layout ? { type: a.type, layout } : null;
    }
    case "apply-layout-template": {
      const template = only("templateId") && typeof a.templateId === "string" ? layoutTemplate(a.templateId) : undefined;
      return template ? { type: a.type, templateId: template.id } : null;
    }
    case "apply-layout-grid":
      return only("columns", "rows") && isGridSize(a.columns, a.rows)
        ? { type: a.type, columns: a.columns as number, rows: a.rows as number }
        : null;
    case "save-snapshot":
      return only("name") && text(a.name, MAX_SNAPSHOT_NAME) ? { type: a.type, name: a.name } : null;
    case "update-snapshot":
    case "apply-snapshot":
    case "delete-snapshot":
      return only("snapshotId") && uuid(a.snapshotId) ? { type: a.type, snapshotId: a.snapshotId } : null;
    case "rename-snapshot":
      return only("snapshotId", "name") && uuid(a.snapshotId) && text(a.name, MAX_SNAPSHOT_NAME)
        ? { type: a.type, snapshotId: a.snapshotId, name: a.name }
        : null;
    default:
      return null;
  }
}
