// Links a publisher key to a Tavora account, so players see the account's developer name instead
// of the key's fingerprint. The developer gets a one-time code in Tavora (Settings > Development,
// signed in); this signs the code with the key and sends the signature and the key's public half to
// Tavora's service. The secret key never leaves this PC.
import { createPublicKey, sign, type KeyObject } from "node:crypto";
import { fingerprint } from "./signature.ts";

export const DEFAULT_API_URL = "https://api.mytavora.app";
/** What is signed: this line, then the code. Nothing else Tavora signs starts like it. */
export const LINK_STATEMENT = "tavora-key-link-1";
const CODE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/;

export class LinkError extends Error {}

/** The code as Tavora shows it ("ABCD-EFGH"), also typed in small letters or with spaces; null when it cannot be one. */
export function cleanLinkCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, "");
  return CODE.test(code) ? code : null;
}

/** The raw 32-byte public half of an Ed25519 key, base64. */
function publicHalf(key: KeyObject): string {
  return (key.type === "private" ? createPublicKey(key) : key).export({ format: "der", type: "spki" }).subarray(12).toString("base64");
}

/** What the service is sent: the code, the public half and the key's signature over the link statement. */
export function linkRequest(key: KeyObject, code: string): { code: string; publicKey: string; signature: string } {
  return { code, publicKey: publicHalf(key), signature: sign(null, Buffer.from(`${LINK_STATEMENT}\n${code}`, "utf8"), key).toString("base64") };
}

const MESSAGES: Record<string, string> = {
  "wrong-code": "That code is wrong or has expired. Get a new one in Tavora: Settings > Development > Publish from CI > Get a link code.",
  "bad-signature": "The service could not check the key's signature.",
  "key-taken": "This key is already linked to another Tavora account.",
  "too-many-keys": "Your account has as many keys as it can link. Unlink one in Tavora first.",
  "too-many": "Too many tries. Wait a few minutes and try again.",
  unavailable: "Linking keys is not available right now.",
};

/** Links the key with the code. Resolves with the key's fingerprint and the developer name players will see. */
export async function linkKey(options: { key: KeyObject; code: string; apiUrl?: string; fetch?: typeof fetch }): Promise<{ fingerprint: string; name: string | null }> {
  const code = cleanLinkCode(options.code);
  if (!code) throw new LinkError("That is not a link code. It looks like ABCD-EFGH, from Tavora: Settings > Development > Publish from CI > Get a link code.");
  const url = `${(options.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, "")}/v1/publishers/link`;
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(linkRequest(options.key, code)),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new LinkError(`Tavora's service could not be reached (${url}). Check your internet connection.`);
  }
  const answer = (await response.json().catch(() => ({}))) as { reason?: unknown; name?: unknown; fingerprint?: unknown };
  if (!response.ok) throw new LinkError((typeof answer.reason === "string" && MESSAGES[answer.reason]) || `The service refused the link (${response.status}).`);
  const own = fingerprint(options.key);
  if (answer.fingerprint !== own) throw new LinkError("The service answered for a different key.");
  return { fingerprint: own, name: typeof answer.name === "string" ? answer.name : null };
}
