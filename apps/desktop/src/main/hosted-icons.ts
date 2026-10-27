import { createHash } from "node:crypto";
import path from "node:path";
import { isGameId } from "@tavora/module-schema";
import { writeFileAtomic } from "./fsutil";
import { normalizeName } from "./launcher-games";
import { hostedIconFileName, type IconResult } from "./steam-icons";

/**
 * Game icons from the Tavora service's hosted set, for games whose icon is
 * not on this PC. The app downloads the service's list of what exists, finds
 * its games in it here, and asks only for the icons it needs, so the service
 * sees which icons are asked for (no log is kept), not a whole library. Each
 * file must be the one the list promised (same hash) with a small PNG header,
 * and is kept unchanged.
 */

export const HOSTED_TIMEOUT_MS = 5000;
export const MAX_HOSTED_ICON_BYTES = 200 * 1024;
const MAX_ICONS = 5000;

export interface HostedIcon {
  id: string;
  names: string[];
  sha256: string;
  size: number;
  /** The maintainer wants a better icon for this game: the app may offer its own, as if there were none. */
  open?: boolean;
}

export interface HostedList {
  /** The notice from the service: names and icons belong to their publishers. */
  notice: string;
  /** Where a publisher asks for an icon to be removed. */
  takedown: string;
  icons: HostedIcon[];
}

export interface HostedOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

const request = (signal: AbortSignal) => ({
  signal,
  // No cookies, no referrer, nothing that says who is asking.
  credentials: "omit" as const,
  referrerPolicy: "no-referrer" as const,
  redirect: "error" as const,
});

function parseIcon(raw: unknown): HostedIcon | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { id, names, sha256, size } = raw as Record<string, unknown>;
  if (!isGameId(id) || typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) return null;
  if (typeof size !== "number" || !Number.isInteger(size) || size < 1 || size > MAX_HOSTED_ICON_BYTES) return null;
  if (!Array.isArray(names)) return null;
  const clean = names.filter((name): name is string => typeof name === "string" && name.trim().length > 0 && name.length <= 120).slice(0, 8);
  return clean.length > 0 ? { id, names: clean, sha256, size } : null;
}

/** The service's list of hosted icons, or null when it cannot be reached or answers something unexpected. */
export async function fetchHostedList(options: HostedOptions): Promise<HostedList | null> {
  try {
    const response = await (options.fetchImpl ?? fetch)(`${options.baseUrl.replace(/\/+$/, "")}/v1/icons`, {
      ...request(AbortSignal.timeout(HOSTED_TIMEOUT_MS)),
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { notice?: unknown; takedown?: unknown; icons?: unknown };
    if (!Array.isArray(body.icons)) return null;
    const seen = new Set<string>();
    const icons: HostedIcon[] = [];
    for (const item of body.icons.slice(0, MAX_ICONS)) {
      const icon = parseIcon(item);
      if (icon && !seen.has(icon.id)) {
        seen.add(icon.id);
        icons.push(icon);
      }
    }
    return {
      notice: typeof body.notice === "string" ? body.notice.slice(0, 2000) : "",
      takedown: typeof body.takedown === "string" ? body.takedown.slice(0, 300) : "",
      icons,
    };
  } catch {
    return null;
  }
}

/** The hosted icon for a game: the same id, the built-in game it is, or the same name as any name listed. */
export function matchHosted(game: { id: string; name: string; catalogId: string | null }, list: HostedList): HostedIcon | null {
  const byId = list.icons.find((icon) => icon.id === game.id || (game.catalogId !== null && icon.id === game.catalogId));
  if (byId) return byId;
  const wanted = normalizeName(game.name);
  return wanted ? (list.icons.find((icon) => icon.names.some((name) => normalizeName(name) === wanted)) ?? null) : null;
}

/** A PNG signature and an IHDR no bigger than an icon. The service has checked the rest. */
function looksLikeIconPng(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 45 || bytes.byteLength > MAX_HOSTED_ICON_BYTES) return false;
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((byte, i) => bytes[i] === byte)) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ihdr = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!) === "IHDR";
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return ihdr && width >= 1 && width <= 256 && height >= 1 && height <= 256;
}

/**
 * Downloads one hosted icon into `iconDir` as `hosted-<gameId>.png`. `none`
 * means the service no longer has it or it is not what was listed (ask again
 * later); `failed` means the service did not answer.
 */
export async function saveHostedIcon(iconDir: string, gameId: string, icon: HostedIcon, options: HostedOptions): Promise<IconResult> {
  if (!isGameId(gameId)) return { status: "none" };
  try {
    const response = await (options.fetchImpl ?? fetch)(`${options.baseUrl.replace(/\/+$/, "")}/v1/icons/${icon.id}.png`, request(AbortSignal.timeout(HOSTED_TIMEOUT_MS)));
    if (response.status === 404 || response.status === 403) return { status: "none" };
    if (!response.ok) return { status: "failed" };
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_HOSTED_ICON_BYTES) return { status: "none" };
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!looksLikeIconPng(bytes) || createHash("sha256").update(bytes).digest("hex") !== icon.sha256) return { status: "none" };
    const file = hostedIconFileName(gameId);
    await writeFileAtomic(path.join(iconDir, file), bytes);
    return { status: "saved", file };
  } catch {
    return { status: "failed" };
  }
}
