/**
 * The pure parts of the media connector (media.ts): checking what a panel asks for, reading the helper's lines
 * (packages/media-helper) and giving apps readable names. Nothing here touches the PC.
 */
import { MEDIA_ACTIONS, type MediaAction, type MediaStatus } from "@tavora/sdk/protocol";
import { HostError } from "./errors";

/** A session as the helper reports it, before Tavora adds the app's name and the cover. */
export interface HelperSession {
  id: string;
  app: string;
  current: boolean;
  title: string;
  artist: string;
  album: string;
  status: MediaStatus;
  positionMs: number | null;
  positionAt: number | null;
  durationMs: number | null;
  canPlayPause: boolean;
  canNext: boolean;
  canPrevious: boolean;
  coverKey: string | null;
}

export type HelperMessage =
  | { type: "ready" }
  | { type: "sessions"; sessions: HelperSession[] }
  | { type: "cover"; id: string; key: string; mime: string; data: string }
  | { type: "result"; req: number; ok: boolean }
  | { type: "error"; message: string };

/** The most sessions Tavora passes on; more than this is not a real PC. */
export const MAX_SESSIONS = 32;
/** Texts are cut to this many characters. */
const MAX_TEXT = 500;
/** A cover line's data, in base64 characters (8 MB of picture). */
export const MAX_COVER_BASE64 = Math.ceil((8 * 1024 * 1024) / 3) * 4;
const STATUSES = new Set<MediaStatus>(["playing", "paused", "stopped", "changing", "closed"]);
const COVER_TYPES = new Set(["image/jpeg", "image/png", "image/bmp", "image/gif", "image/webp", ""]);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max = MAX_TEXT): string | null => (typeof value === "string" ? value.slice(0, max) : null);
const whole = (value: unknown): number | null | undefined =>
  value === null ? null : typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

function parseSession(value: unknown): HelperSession | null {
  if (!isRecord(value)) return null;
  const id = text(value.id, 1000);
  const app = text(value.app, 1000);
  const title = text(value.title);
  const artist = text(value.artist);
  const album = text(value.album);
  const status = value.status as MediaStatus;
  const positionMs = whole(value.positionMs ?? null);
  const positionAt = whole(value.positionAt ?? null);
  const durationMs = whole(value.durationMs ?? null);
  const coverKey = value.coverKey === null || value.coverKey === undefined ? null : text(value.coverKey, 2000);
  if (!id || app === null || title === null || artist === null || album === null || !STATUSES.has(status)) return null;
  if (positionMs === undefined || positionAt === undefined || durationMs === undefined || coverKey === null && value.coverKey) return null;
  const flags = [value.current, value.canPlayPause, value.canNext, value.canPrevious];
  if (flags.some((flag) => typeof flag !== "boolean")) return null;
  return {
    id,
    app,
    current: value.current as boolean,
    title,
    artist,
    album,
    status,
    positionMs,
    positionAt,
    durationMs,
    canPlayPause: value.canPlayPause as boolean,
    canNext: value.canNext as boolean,
    canPrevious: value.canPrevious as boolean,
    coverKey,
  };
}

/** One line from the helper, or null when it isn't one Tavora knows. A session that doesn't check out is left out. */
export function parseHelperLine(line: string): HelperMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  switch (value.type) {
    case "ready":
      return { type: "ready" };
    case "sessions": {
      if (!Array.isArray(value.sessions)) return null;
      const sessions = value.sessions.slice(0, MAX_SESSIONS).map(parseSession).filter((s): s is HelperSession => s !== null);
      return { type: "sessions", sessions };
    }
    case "cover": {
      const { id, key, mime, data } = value;
      if (typeof id !== "string" || typeof key !== "string" || typeof mime !== "string" || typeof data !== "string") return null;
      if (!COVER_TYPES.has(mime.toLowerCase()) || data.length === 0 || data.length > MAX_COVER_BASE64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return null;
      return { type: "cover", id, key, mime: mime.toLowerCase(), data };
    }
    case "result":
      return typeof value.req === "number" && typeof value.ok === "boolean" ? { type: "result", req: value.req, ok: value.ok } : null;
    case "error":
      return { type: "error", message: text(value.message) ?? "" };
    default:
      return null;
  }
}

/** Apps whose Windows name says little; the rest are named after their program or package. */
const KNOWN_APPS: [RegExp, string][] = [
  [/spotify/i, "Spotify"],
  // A site or web app in a window of its own is "Chrome.<app>" or "MSEdge.<site>": named after the browser.
  [/^chrome$|chrome\.exe$|^chrome\./i, "Chrome"],
  [/^msedge$|msedge\.exe$|^msedge\./i, "Edge"],
  // Firefox registers itself under a hash of its install folder.
  [/^308046B0AF4A39CB$|firefox/i, "Firefox"],
  [/brave/i, "Brave"],
  [/opera/i, "Opera"],
  [/vivaldi/i, "Vivaldi"],
  [/AppleInc\.AppleMusic|AppleMusic/i, "Apple Music"],
  [/Microsoft\.ZuneMusic/i, "Media Player"],
  [/Microsoft\.ZuneVideo/i, "Movies & TV"],
  [/vlc/i, "VLC"],
  [/tidal/i, "TIDAL"],
  [/deezer/i, "Deezer"],
  [/amazon.*music/i, "Amazon Music"],
  [/youtube.*music/i, "YouTube Music"],
  [/foobar2000/i, "foobar2000"],
  [/musicbee/i, "MusicBee"],
  [/aimp/i, "AIMP"],
  [/discord/i, "Discord"],
];

/** A readable name for an app as Windows names it (a program such as "Spotify.exe", or a Store package). */
export function appName(appId: string): string {
  for (const [pattern, name] of KNOWN_APPS) if (pattern.test(appId)) return name;
  // A Store app: "Publisher.Name_hash!App" -> "Name".
  const packaged = /^[^.!_]+\.([^_!]+)_[^!]*!/.exec(appId);
  const base = packaged?.[1] ?? appId.split(/[\\/]/).pop()!.replace(/\.exe$/i, "");
  const name = base.replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : "Unknown app";
}

/** media.watch: `{ on: boolean }`, nothing else. */
export function parseWatchParams(params: unknown): boolean {
  if (!isRecord(params)) throw new HostError("INVALID_PARAMS", "params must be an object");
  for (const key of Object.keys(params)) if (key !== "on") throw new HostError("INVALID_PARAMS", `params.${key} is not known`);
  if (typeof params.on !== "boolean") throw new HostError("INVALID_PARAMS", "params.on must be true or false");
  return params.on;
}

/** media.control: `{ session, action }` with a session id and one of MEDIA_ACTIONS. */
export function parseControlParams(params: unknown): { session: string; action: MediaAction } {
  if (!isRecord(params)) throw new HostError("INVALID_PARAMS", "params must be an object");
  for (const key of Object.keys(params)) if (key !== "session" && key !== "action") throw new HostError("INVALID_PARAMS", `params.${key} is not known`);
  const { session, action } = params;
  if (typeof session !== "string" || session.length === 0 || session.length > 1000) throw new HostError("INVALID_PARAMS", "params.session must be a session id");
  if (!MEDIA_ACTIONS.includes(action as MediaAction)) throw new HostError("INVALID_PARAMS", `params.action must be one of ${MEDIA_ACTIONS.join(", ")}`);
  return { session, action: action as MediaAction };
}
