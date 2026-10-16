/**
 * Discord login (decided 2026-10-16): the app sends the code Discord gave it
 * after the player approved Tavora in the browser, with the PKCE verifier only
 * the app knew. The service exchanges them itself, reads who the player is,
 * and throws the Discord token away at once (revoking it too). Tavora's
 * Discord application is a public client, so no secret exists anywhere; only
 * the `identify` scope is asked for, never the email.
 */

/** Tavora's application in the Discord Developer Portal (public id, the same app as the Discord panel). */
export const DISCORD_CLIENT_ID = "1560388687370387610";
/** Where Discord sends the browser back: the app listens there for one return (added in the Developer Portal). */
export const DISCORD_REDIRECT_URI = "http://127.0.0.1:53682/discord";
export const DISCORD_API = "https://discord.com/api";

export interface DiscordIdentity {
  /** Discord's user id: never changes and is never reused, so it is the identity. */
  id: string;
  /** The username (@name): unique today but changeable, so only a label. */
  name: string;
}

/** Discord said no (a used or wrong code, a wrong verifier), or could not be reached. */
export class DiscordError extends Error {
  readonly reason: "discord-refused" | "discord-unreachable";
  constructor(reason: "discord-refused" | "discord-unreachable") {
    super(reason === "discord-refused" ? "Discord did not accept the sign-in." : "Discord could not be reached.");
    this.name = "DiscordError";
    this.reason = reason;
  }
}

export interface DiscordClient {
  identify(code: string, verifier: string): Promise<DiscordIdentity>;
}

/** What the app may send: Discord's codes are short letters and digits; PKCE verifiers are 43 to 128 unreserved characters. */
export const isDiscordCode = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9]{10,100}$/.test(value);
export const isPkceVerifier = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9._~-]{43,128}$/.test(value);

const SNOWFLAKE = /^\d{17,20}$/;

/** A username as a label: control and direction characters dropped, at most 32 characters (Discord's own limit). */
export function cleanDiscordName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = [...value.replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, "").trim()].slice(0, 32).join("");
  return name || null;
}

export function createDiscordClient(options: { clientId?: string; redirectUri?: string; api?: string; fetch?: typeof fetch; timeoutMs?: number } = {}): DiscordClient {
  const clientId = options.clientId ?? DISCORD_CLIENT_ID;
  const api = (options.api ?? DISCORD_API).replace(/\/+$/, "");
  const fetchImpl = options.fetch ?? fetch;
  const timeout = () => AbortSignal.timeout(options.timeoutMs ?? 10_000);
  const form = (fields: Record<string, string>) => ({
    method: "POST",
    signal: timeout(),
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(fields).toString(),
  });

  return {
    async identify(code, verifier) {
      let token: string;
      try {
        const response = await fetchImpl(`${api}/oauth2/token`, form({ client_id: clientId, grant_type: "authorization_code", code, redirect_uri: options.redirectUri ?? DISCORD_REDIRECT_URI, code_verifier: verifier }));
        if (!response.ok) throw new DiscordError(response.status >= 500 ? "discord-unreachable" : "discord-refused");
        const body = (await response.json()) as { access_token?: unknown; scope?: unknown };
        if (typeof body.access_token !== "string" || !body.access_token) throw new DiscordError("discord-refused");
        token = body.access_token;
      } catch (error) {
        throw error instanceof DiscordError ? error : new DiscordError("discord-unreachable");
      }
      try {
        const response = await fetchImpl(`${api}/users/@me`, { signal: timeout(), headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
        if (!response.ok) throw new DiscordError(response.status >= 500 ? "discord-unreachable" : "discord-refused");
        const user = (await response.json()) as { id?: unknown; username?: unknown };
        const name = cleanDiscordName(user.username);
        if (typeof user.id !== "string" || !SNOWFLAKE.test(user.id) || !name) throw new DiscordError("discord-refused");
        return { id: user.id, name };
      } catch (error) {
        throw error instanceof DiscordError ? error : new DiscordError("discord-unreachable");
      } finally {
        // The token was only needed to read who this is: revoke it, best effort, and never keep it.
        await fetchImpl(`${api}/oauth2/token/revoke`, form({ client_id: clientId, token, token_type_hint: "access_token" })).catch(() => undefined);
      }
    },
  };
}
