// "Ask for a module": a game with no modules offers one click that sends one anonymous vote to Tavora's
// service. It sends the game's name, its Steam application id and Tavora's id for it when it has them, and a
// code: a hash of a random number that stays on this PC and the game's key. So the service can count one vote
// per PC and game, but can't tell which games came from the same PC. No cookies, no referrer, no sign-in.
// Only called while Online features are on, and only because the user pressed the button.
import { createHash, randomBytes } from "node:crypto";
import { askKey, type AskedGame } from "../shared/module-request";
import { serviceUrl } from "./service-url";

export { askKey, type AskedGame };

/** A new random number for this install: 64 lowercase hex digits. */
export const newInstallId = (): string => randomBytes(32).toString("hex");

/** The code sent for a game: never the install's number itself, so games asked from one PC can't be linked. */
export function voterFor(installId: string, game: AskedGame): string {
  return createHash("sha256").update(`${installId}|${askKey(game)}`).digest("hex");
}

/**
 * Sends the vote. True when the service took it (any 2xx); false for everything else: no connection, a refusal,
 * a busy service, or an address that does not exist yet (404), which is the same as being offline. Never throws.
 */
export async function sendModuleRequest(options: { baseUrl?: string; fetchImpl?: typeof fetch }, game: AskedGame, installId: string): Promise<boolean> {
  const base = serviceUrl(options.baseUrl);
  const body = {
    game: { name: game.name, ...(game.steamAppId !== null ? { steamAppId: game.steamAppId } : {}), ...(game.gameId !== null ? { gameId: game.gameId } : {}) },
    voter: voterFor(installId, game),
  };
  try {
    const response = await (options.fetchImpl ?? fetch)(`${base}/v1/module-requests`, {
      credentials: "omit",
      referrerPolicy: "no-referrer",
      redirect: "error",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
