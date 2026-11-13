import type { ZipFile } from "./zip.ts";

/**
 * Extensions of private key files. A module has no use for one, so a module zip never holds one: the packer stops and
 * the catalog refuses the zip (decided 2026-11-13). The same list as module-schema's KEY_EXTENSIONS for folder access.
 */
export const PRIVATE_KEY_EXTENSIONS: readonly string[] = ["pem", "key", "p12", "pfx", "ppk"];

/** Stops a pack: a file in the module folder is, or holds, a private key. */
export function privateKeyMessage(file: string): string {
  return `${file} looks like a private key, and a module zip never holds one. Move it out of the module folder (or build into dist/) and pack again`;
}

/** How many key headers one file is looked at for; past that, the file is taken for one. */
const MAX_HEADERS = 64;
/** How far past a key's header its body is looked for. */
const BODY_WINDOW = 1024;
const HEADER_END = Buffer.from("PRIVATE KEY", "latin1");
// "-----BEGIN <words >PRIVATE KEY-----" or "... PRIVATE KEY BLOCK-----" (PGP), the BEGIN part read backwards from the hit.
const BEFORE_HIT = /-----BEGIN (?:[A-Z0-9]+ ){0,4}$/;
const AFTER_HIT = /^(?: BLOCK)?-----/;

/** Whether a name has a private key file's extension (case doesn't matter). */
export function hasKeyExtension(name: string): boolean {
  const base = name.slice(name.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 && PRIVATE_KEY_EXTENSIONS.includes(base.slice(dot + 1).toLowerCase());
}

/**
 * Whether bytes hold a private key: a PEM or PGP private key header followed by its base64 body (written out, or
 * escaped inside a string as a bundle has it), or a PuTTY key. Code that only names a format ("-----BEGIN PRIVATE
 * KEY-----\n" + body) has no body after the header and passes; public keys and certificates pass too.
 */
export function holdsPrivateKey(data: Buffer): boolean {
  if (data.subarray(0, 64).includes("PuTTY-User-Key-File-")) return true;
  let headers = 0;
  for (let hit = data.indexOf(HEADER_END); hit !== -1; hit = data.indexOf(HEADER_END, hit + HEADER_END.length)) {
    if (!BEFORE_HIT.test(data.subarray(Math.max(0, hit - 64), hit).toString("latin1"))) continue;
    const after = data.subarray(hit + HEADER_END.length, hit + HEADER_END.length + BODY_WINDOW).toString("latin1");
    const header = AFTER_HIT.exec(after);
    if (!header) continue;
    if (++headers > MAX_HEADERS) return true;
    if (hasBody(after.slice(header[0].length))) return true;
  }
  return false;
}

/** After a key header: optional "Name: value" header lines and blank lines, then a line of base64. */
function hasBody(text: string): boolean {
  const lines = text.replace(/\\r\\n|\\n|\\r/g, "\n").split(/\r?\n|\r/);
  // The header line's own end leaves an empty first entry.
  for (const line of lines.slice(1, 12)) {
    const trimmed = line.trim();
    if (trimmed === "" || /^[A-Za-z][\w-]*: /.test(trimmed)) continue;
    return /^[A-Za-z0-9+/]{40,}/.test(trimmed);
  }
  return false;
}

/** The first file that is, or holds, a private key; null when there is none. */
export function privateKeyFile(files: readonly ZipFile[]): string | null {
  return files.find((file) => hasKeyExtension(file.name) || holdsPrivateKey(file.data))?.name ?? null;
}
