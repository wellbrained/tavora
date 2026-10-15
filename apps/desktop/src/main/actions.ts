import { isGameId, isModuleId } from "@tavora/module-schema";
import type { HostAction } from "../shared/host-api";
import { INSTANCE_ID } from "./ids";
import { parseLayout } from "./layout";
import { MAX_INITIALS, MAX_PICTURE_BYTES, MAX_PROFILE_NAME } from "./profile";
import { isSteamAppId } from "./steam-icons";
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
    case "check-for-updates":
    case "restart-to-update":
    case "reset-theme":
    case "reload-themes":
    case "open-themes-folder":
    case "create-starter-theme":
      return only() ? { type: a.type } : null;
    case "set-theme":
      return only("themeId", "variationId") && isModuleId(a.themeId) && isVariationId(a.variationId)
        ? { type: a.type, themeId: a.themeId, variationId: a.variationId }
        : null;
    case "open-game":
    case "choose-game-image":
    case "trash-game":
    case "restore-game":
    case "delete-game":
    case "unfavorite":
      return only("gameId") && isGameId(a.gameId) ? { type: a.type, gameId: a.gameId } : null;
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
      return only("enabled") && typeof a.enabled === "boolean" ? { type: a.type, enabled: a.enabled } : null;
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
    case "open-module":
      return only("moduleId") && isModuleId(a.moduleId) ? { type: a.type, moduleId: a.moduleId } : null;
    case "close-panel":
    case "reload-panel":
    case "stop-panel":
      return only("instanceId") && uuid(a.instanceId)
        ? { type: a.type, instanceId: a.instanceId }
        : null;
    case "save-layout": {
      const layout = only("layout") ? parseLayout(a.layout) : null;
      return layout ? { type: a.type, layout } : null;
    }
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
