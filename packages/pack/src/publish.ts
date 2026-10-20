// Publishes a packed module to Tavora's module catalog. The zip must be signed with this key (the
// pack command does that), and the key must be linked to your Tavora account (Tavora links the keys it
// keeps; a key file is linked with `tavora-pack link`). Besides the zip, only a signature over its
// SHA-256 is sent; the secret key never leaves this PC.
import { createHash, sign, type KeyObject } from "node:crypto";
import { DEFAULT_API_URL } from "./link.ts";
import { verifyFiles } from "./signature.ts";
import { asSigner, type Signer } from "./signer.ts";
import { readZip, ZipError } from "./zip.ts";

/** What is signed: this line, then the zip's SHA-256 in hex. Nothing else Tavora signs starts like it. */
export const PUBLISH_STATEMENT = "tavora-catalog-publish-1";

export class PublishError extends Error {}

/** The signature (base64) the service checks: this key over the publish statement for these bytes. */
export function publishSignature(key: KeyObject, zip: Buffer): string {
  const sha256 = createHash("sha256").update(zip).digest("hex");
  return sign(null, Buffer.from(`${PUBLISH_STATEMENT}\n${sha256}`, "utf8"), key).toString("base64");
}

const MESSAGES: Record<string, string> = {
  "key-not-linked": "Your publisher key is not linked to a Tavora account yet. Link it in Tavora (Settings > Account > Module developer). A key file: get a link code there and run tavora-pack link <code> --key <file>",
  "prefix-taken": "Another developer publishes under this id prefix. Give your module an id with a prefix of your own, such as <your name>.<module>.",
  "prefix-reserved": "This id prefix is reserved. Give your module an id with a prefix of your own, such as <your name>.<module>.",
  "too-many-prefixes": "Your account already publishes under 3 id prefixes. Use one of them for this module.",
  "daily-limit": "Your account has published as many versions as it can today. Try again tomorrow.",
  "account-full": "Your modules take as much room in the catalog as an account may have.",
  "catalog-full": "The catalog has no room right now. Tavora has been told; try again later.",
  "too-many": "Too many uploads from this connection. Wait a while and try again.",
  "too-big": "The zip is too big for the catalog.",
  unavailable: "Publishing is not available right now.",
};

/** Publishes the zip. Resolves with the id, version and hash the catalog now lists. */
export async function publishZip(options: { key: KeyObject | Signer; zip: Buffer; apiUrl?: string; fetch?: typeof fetch }): Promise<{ id: string; version: string; sha256: string }> {
  // Checked here first, so a zip signed with another key fails with a clear message before any upload.
  let verified;
  try {
    verified = verifyFiles(readZip(options.zip));
  } catch (error) {
    if (error instanceof ZipError) throw new PublishError(`That is not a module zip tavora-pack can read: ${error.message}.`);
    throw error;
  }
  if (!verified.ok) throw new PublishError(`The zip was refused: ${verified.reason}.`);
  if (!verified.signed) throw new PublishError("The zip is not signed. Pack it with tavora-pack, which signs it with your publisher key.");
  const signer = asSigner(options.key);
  if (verified.owner !== signer.fingerprint) throw new PublishError("The zip was signed with another publisher key. Publish it with the key that packed it (--key or --publisher).");
  const sha256 = createHash("sha256").update(options.zip).digest("hex");
  const signature = (await signer.signPublish(options.zip, sha256)).toString("base64");

  const url = `${(options.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, "")}/v1/catalog/publish`;
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(url, {
      method: "POST",
      headers: { "Content-Type": "application/zip", Accept: "application/json", "X-Tavora-Signature": signature },
      body: new Uint8Array(options.zip),
      redirect: "error",
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    throw new PublishError(`Tavora's service could not be reached (${url}). Check your internet connection.`);
  }
  const answer = (await response.json().catch(() => ({}))) as { reason?: unknown; error?: unknown; id?: unknown; version?: unknown; sha256?: unknown };
  if (!response.ok) {
    const known = typeof answer.reason === "string" ? MESSAGES[answer.reason] : undefined;
    // "invalid" and "conflict" carry the service's own sentence about this zip.
    throw new PublishError(known ?? (typeof answer.error === "string" ? answer.error : `The service refused the upload (${response.status}).`));
  }
  if (typeof answer.id !== "string" || typeof answer.version !== "string" || typeof answer.sha256 !== "string") throw new PublishError("The service gave an answer tavora-pack does not understand.");
  return { id: answer.id, version: answer.version, sha256: answer.sha256 };
}
