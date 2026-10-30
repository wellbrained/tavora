// What the Discord connector itself reads from Discord: the signed-in user
// and the scopes of a sign-in, and the pictures it fetches for modules from
// Discord's image server. Everything else Discord says is passed on to the
// module as it came; the Discord module reads it (tavora-modules: discord).

const SNOWFLAKE = /^\d{1,20}$/;
export const MAX_NAME = 64;

export const isSnowflake = (value: unknown): value is string => typeof value === "string" && SNOWFLAKE.test(value);

const record = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

export function cleanName(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  // No control or bidirectional override characters, so a name can't reorder the text around it.
  const name = value.replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, "").trim();
  return name ? [...name].slice(0, MAX_NAME).join("") : fallback;
}

/** The scopes Discord says the sign-in has, from AUTHENTICATE. */
export function parseScopes(raw: unknown): string[] {
  const scopes = record(raw).scopes;
  return Array.isArray(scopes) ? scopes.filter((scope): scope is string => typeof scope === "string").slice(0, 20) : [];
}

/** The signed-in user from AUTHENTICATE. */
export function parseUser(raw: unknown): { id: string; name: string } | null {
  const user = record(record(raw).user);
  return isSnowflake(user.id) ? { id: user.id, name: cleanName(user.global_name, cleanName(user.username, "You")) } : null;
}

const CDN = "https://cdn.discordapp.com/";

/**
 * A picture address on Discord's image server, if it is one: only
 * `avatars/<user id>/<hash>` and `icons/<server id>/<hash>`, and always asked
 * for as a small PNG. Anything else (another host, attachments, http) is null.
 */
export function imageUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 300) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.origin + "/" !== CDN || url.username || url.password) return null;
  const match = /^\/(avatars|icons)\/(\d{1,20})\/((?:a_)?[0-9a-f]{32})\.(?:png|webp|jpg|jpeg|gif)$/.exec(url.pathname);
  return match ? `${CDN}${match[1]}/${match[2]}/${match[3]}.png?size=64` : null;
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Largest picture Tavora keeps; a 64-pixel PNG is a few kilobytes. */
export const MAX_IMAGE = 256 * 1024;

/** A PNG from Discord as a data address, or null when it is not a small PNG. */
export function pngDataUrl(bytes: Buffer): string | null {
  if (bytes.length > MAX_IMAGE || bytes.length < PNG.length || !bytes.subarray(0, PNG.length).equals(PNG)) return null;
  return `data:image/png;base64,${bytes.toString("base64")}`;
}
