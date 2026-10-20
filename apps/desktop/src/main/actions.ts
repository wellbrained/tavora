import { isConnector, isGameId, isModuleId, isNetworkHost, isOwnerId, isPanelTypeId, MAX_NETWORK_HOSTS } from "@tavora/module-schema";
import type { ActionResult, HostAction, HostActionType } from "../shared/host-api";
import { check, hostActionTable, parseHostAction, parsed, type HostChecks } from "../shared/host-actions";
import { isSite, MAX_ADDRESS } from "./browser-url";
import { INSTANCE_ID } from "./ids";
import { GAME_START_CHOICES } from "./library";
import { parseLayout } from "./layout";
import { MAX_INITIALS, MAX_PICTURE_BYTES, MAX_PROFILE_NAME } from "./profile";
import { isSteamAppId } from "./steam-icons";
import { MAX_IMPORT_GAMES, parseSteamGame } from "./steam-import";
import { isVariationId } from "./themes";
import { MAX_SNAPSHOT_NAME } from "./workspace";

export type { ActionResult, HostAction } from "../shared/host-api";
export { MAX_SHARE_BATCH } from "../shared/host-actions";

const text = (max: number) => check<string>((value) => typeof value === "string" && value.length <= max);
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const CHECKS: HostChecks = {
  gameId: check(isGameId),
  moduleId: check(isModuleId),
  ownerId: check(isOwnerId),
  panelType: check(isPanelTypeId),
  uuid: check((value) => typeof value === "string" && INSTANCE_ID.test(value)),
  site: check(isSite),
  address: check((value) => typeof value === "string" && value.length <= MAX_ADDRESS && value.trim() !== ""),
  steamAppId: check(isSteamAppId),
  // Exactly the fields the dialog got from the service, nothing more.
  steamGame: parsed((value) =>
    typeof value === "object" && value !== null && Object.keys(value).every((key) => key === "appid" || key === "name" || key === "id") ? parseSteamGame(value) : null,
  ),
  variationId: check(isVariationId),
  gameStart: check((value) => GAME_START_CHOICES.some((choice) => choice === value)),
  layout: parsed(parseLayout),
  networkHosts: check(
    (value) => Array.isArray(value) && value.length <= MAX_NETWORK_HOSTS && value.every(isNetworkHost) && new Set(value).size === value.length,
  ),
  connector: check(isConnector),
  snapshotName: text(MAX_SNAPSHOT_NAME),
  // Code units, so emoji still fit; both are clipped by character when stored.
  profileName: text(MAX_PROFILE_NAME * 2),
  initials: text(MAX_INITIALS * 2),
  picture: check((value) => typeof value === "string" && value.length <= Math.ceil(MAX_PICTURE_BYTES / 3) * 4 && BASE64.test(value)),
  maxImportGames: MAX_IMPORT_GAMES,
};

const ACTIONS = hostActionTable(CHECKS);

/** Every kind of action the host UI can send. */
export const ACTION_TYPES = Object.keys(ACTIONS) as HostActionType[];

/**
 * Checks a message from the host UI. The host UI is trusted code, but its
 * messages are still parsed strictly: a bug there must not be able to write
 * arbitrary data into the library. Returns null for anything malformed.
 */
export function parseAction(raw: unknown): HostAction | null {
  return parseHostAction(ACTIONS, raw);
}

/** What a handler answers: a full result, the id of something it made, or nothing. */
export type ActionReply = ActionResult | string | void;

/** One handler for every kind of action; the compiler says when one is missing. */
export type ActionHandlers = { [K in HostActionType]: (action: Extract<HostAction, { type: K }>) => ActionReply | Promise<ActionReply> };

/** Runs the action's handler and turns its reply into the result the host UI gets. */
export async function runAction(handlers: ActionHandlers, action: HostAction): Promise<ActionResult> {
  const handler = handlers[action.type] as (action: HostAction) => ActionReply | Promise<ActionReply>;
  const reply = await handler(action);
  if (reply === undefined) return { ok: true };
  return typeof reply === "string" ? { ok: true, id: reply } : reply;
}
