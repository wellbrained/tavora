import { isGameId, isModuleId } from "@tavora/module-schema";
import type { BrowserCommand, HostAction, SteamImportGame } from "../shared/host-api";
import { isSite, MAX_ADDRESS } from "./browser-url";
import { isClientSecret } from "./discord-store";
import { isSnowflake } from "./discord-voice";
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
      return only() ? { type: a.type } : null;
    case "remove-module":
      return only("moduleId") && isModuleId(a.moduleId) ? { type: a.type, moduleId: a.moduleId } : null;
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
    case "share-icons":
      return only("gameIds") &&
        Array.isArray(a.gameIds) &&
        a.gameIds.length >= 1 &&
        a.gameIds.length <= 50 &&
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
    case "discord-set-secret":
      return only("secret") && (a.secret === null || isClientSecret(a.secret)) ? { type: a.type, secret: a.secret } : null;
    case "discord-leave":
    case "discord-allow-control":
    case "discord-refresh":
      return only() ? { type: a.type } : null;
    case "discord-voice": {
      const ok = (value: unknown) => value === undefined || typeof value === "boolean";
      if (!only("mute", "deaf") || !ok(a.mute) || !ok(a.deaf) || (a.mute === undefined && a.deaf === undefined)) return null;
      return { type: a.type, ...(a.mute === undefined ? {} : { mute: a.mute as boolean }), ...(a.deaf === undefined ? {} : { deaf: a.deaf as boolean }) };
    }
    case "discord-game-remember":
      return only("gameId", "remember") && isGameId(a.gameId) && typeof a.remember === "boolean" ? { type: a.type, gameId: a.gameId, remember: a.remember } : null;
    case "discord-game-server":
      return only("gameId", "guildId") && isGameId(a.gameId) && isSnowflake(a.guildId) ? { type: a.type, gameId: a.gameId, guildId: a.guildId } : null;
    case "discord-join":
      return only("channelId") && isSnowflake(a.channelId) ? { type: a.type, channelId: a.channelId } : null;
    case "discord-connect":
    case "discord-sign-out":
      return only() ? { type: a.type } : null;
    case "open-module":
      return only("moduleId") && isModuleId(a.moduleId) ? { type: a.type, moduleId: a.moduleId } : null;
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
