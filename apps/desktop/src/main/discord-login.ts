import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { Language } from "../shared/i18n";
import { PlayerError } from "./messages";

// Discord login for the Tavora account (decided 2026-10-16): Discord's sign-in
// page opens in the player's own browser, and Discord sends the browser back to
// this PC, where Tavora listens for exactly one return. Separate from the
// Discord panel's connection: no Discord token ever reaches this PC; the code
// and the PKCE verifier go to Tavora's service, which asks Discord who this is.

/** Tavora's public Discord app (the same as the Discord panel's); no secret exists. */
export const DISCORD_LOGIN_CLIENT_ID = "1560388687370387610";
export const DISCORD_LOGIN_PORT = 53682;
/** Registered in the Discord Developer Portal; the service uses the same address for the exchange. */
export const DISCORD_LOGIN_REDIRECT = `http://127.0.0.1:${DISCORD_LOGIN_PORT}/discord`;
export const DISCORD_AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
/** How long Tavora waits for the player to approve in the browser. */
export const DISCORD_LOGIN_TIMEOUT_MS = 2 * 60_000;

export interface DiscordLoginResult {
  code: string;
  verifier: string;
}

export interface DiscordLoginOptions {
  /** Opens the address in the player's browser (Electron's shell.openExternal). */
  open: (url: string) => Promise<void>;
  language: () => Language;
  authorizeUrl?: string;
  port?: number;
  timeoutMs?: number;
}

const base64url = (bytes: Buffer) => bytes.toString("base64url");

const PAGE = {
  en: { done: "You are signed in with Discord. You can close this tab and go back to Tavora.", failed: "Discord sign-in did not finish. Go back to Tavora and try again." },
  de: { done: "Du bist mit Discord angemeldet. Du kannst diesen Tab schließen und zu Tavora zurückkehren.", failed: "Die Discord-Anmeldung wurde nicht abgeschlossen. Geh zurück zu Tavora und versuch es noch einmal." },
} as const;

function page(text: string, language: Language): string {
  return `<!doctype html><html lang="${language}"><meta charset="utf-8"><title>Tavora</title><body style="font:16px system-ui;background:#191a1d;color:#f1e9db;display:grid;place-items:center;height:90vh;margin:0"><p style="max-width:28rem;text-align:center">${text}</p></body></html>`;
}

/** One sign-in at a time: a second one while the first waits replaces it. */
let current: { server: Server; fail: (error: Error) => void } | null = null;

/**
 * Runs Discord's browser sign-in and resolves with the code and the PKCE
 * verifier. Listens only on 127.0.0.1, accepts one return carrying its own
 * random `state`, and stops after it or after two minutes.
 */
export async function discordLogin(options: DiscordLoginOptions): Promise<DiscordLoginResult> {
  current?.fail(new PlayerError("account.error.discordCancelled"));
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(16));
  const port = options.port ?? DISCORD_LOGIN_PORT;
  const language = options.language();

  return new Promise<DiscordLoginResult>((resolve, reject) => {
    let settled = false;
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
      // Every answer closes its connection: a browser that kept one open would send the next sign-in's
      // return to this listener after it stopped, and that sign-in would wait in vain.
      if (request.method !== "GET" || url.pathname !== "/discord") {
        response.writeHead(404, { connection: "close" }).end();
        return;
      }
      const code = url.searchParams.get("code");
      const ok = url.searchParams.get("state") === state && code !== null && /^[A-Za-z0-9]{10,100}$/.test(code);
      response.writeHead(ok ? 200 : 400, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'", connection: "close" });
      response.end(page(ok ? PAGE[language].done : PAGE[language].failed, language));
      // A return without our state is someone else's (or an old tab): not ours to act on.
      if (url.searchParams.get("state") !== state) return;
      if (ok) finish(null, { code: code!, verifier });
      else finish(new PlayerError(url.searchParams.get("error") === "access_denied" ? "account.error.discordCancelled" : "account.error.discordRefused"));
    });
    const timer = setTimeout(() => finish(new PlayerError("account.error.discordCancelled")), options.timeoutMs ?? DISCORD_LOGIN_TIMEOUT_MS);
    const finish = (error: Error | null, result?: DiscordLoginResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      server.closeIdleConnections();
      if (current?.server === server) current = null;
      if (error) reject(error);
      else resolve(result!);
    };
    current = { server, fail: (error) => finish(error) };
    server.once("error", () => finish(new PlayerError("account.error.discordPort", { port })));
    server.listen(port, "127.0.0.1", () => {
      const authorize = new URL(options.authorizeUrl ?? DISCORD_AUTHORIZE_URL);
      authorize.search = new URLSearchParams({
        client_id: DISCORD_LOGIN_CLIENT_ID,
        response_type: "code",
        redirect_uri: DISCORD_LOGIN_REDIRECT,
        scope: "identify",
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
      }).toString();
      options.open(authorize.toString()).catch(() => finish(new PlayerError("account.error.discordBrowser")));
    });
  });
}
