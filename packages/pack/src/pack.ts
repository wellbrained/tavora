import type { KeyObject } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { CHANGELOG_LIMITS, manifestFiles, MAX_README_BYTES, validateChangelog, validateManifest, type ModuleManifest } from "@tavora/module-schema";
import { fileHashes, SIGNATURE_FILE, signatureFile } from "./signature.ts";
import { asSigner, type Signer } from "./signer.ts";
import { isSafeEntryName, readZip, writeZip, ZIP_LIMITS, ZipError, type ZipFile } from "./zip.ts";

export const MANIFEST_FILE = "tavora.module.json";

export class PackError extends Error {}

/**
 * The files of a module folder that go into its zip: the manifest, the folders
 * its entry pages are in (usually dist/), the icons, the screenshots, the readme and the changelog. When the entry page sits
 * next to the manifest, everything goes except node_modules and dot files.
 */
export async function collectFiles(dir: string): Promise<{ manifest: ModuleManifest; files: ZipFile[] }> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path.join(dir, MANIFEST_FILE), "utf8"));
  } catch {
    throw new PackError(`${MANIFEST_FILE} is missing or not valid JSON in ${dir}`);
  }
  const result = validateManifest(raw);
  if (!result.ok) throw new PackError(`${MANIFEST_FILE} is not valid: ${result.errors.join("; ")}`);
  const { manifest } = result;

  const names = new Set<string>([MANIFEST_FILE]);
  const { entries, icons, screenshots } = manifestFiles(manifest);
  // Panel types may have pages of their own; each page's folder goes in.
  const folders = new Set(entries.map((entry) => (entry.includes("/") ? entry.split("/")[0]! : "")));
  for (const folder of folders) for (const name of await walk(dir, folder)) names.add(name);
  for (const icon of [...icons, ...screenshots]) names.add(icon);
  if (manifest.readme !== undefined) {
    const info = await lstat(path.join(dir, manifest.readme)).catch(() => null);
    if (info?.isFile() && info.size > MAX_README_BYTES) throw new PackError(`${manifest.readme} is bigger than a readme may be (${MAX_README_BYTES / 1024} KB)`);
    names.add(manifest.readme);
  }
  if (manifest.changelog !== undefined) {
    await checkChangelog(dir, manifest.changelog);
    names.add(manifest.changelog);
  }
  for (const entry of entries) if (!names.has(entry)) throw new PackError(`the entry page ${entry} is missing (is the module built?)`);
  names.delete(SIGNATURE_FILE);

  const files: ZipFile[] = [];
  let total = 0;
  for (const name of [...names].sort()) {
    if (!isSafeEntryName(name)) throw new PackError(`${name} cannot go into a module zip (its name is not allowed)`);
    await refuseLinks(dir, name);
    const info = await lstat(path.join(dir, name)).catch(() => null);
    if (!info?.isFile()) throw new PackError(`${name} is missing or not a plain file`);
    total += info.size;
    if (total > ZIP_LIMITS.maxUnpackedBytes) throw new PackError("the module is bigger than a module zip may be");
    files.push({ name, data: await readFile(path.join(dir, name)) });
  }
  if (files.length > ZIP_LIMITS.maxFiles - 1) throw new PackError(`a module zip may have at most ${ZIP_LIMITS.maxFiles - 1} files`);
  return { manifest, files };
}

/** Refuses a file or folder whose path, from the module folder down, passes through a link: it could lead out of the module. */
async function refuseLinks(root: string, relative: string): Promise<void> {
  let current = root;
  for (const part of relative.split("/").filter(Boolean)) {
    current = path.join(current, part);
    const info = await lstat(current).catch(() => null);
    if (info?.isSymbolicLink()) throw new PackError(`${relative} goes through a link (${part}); a module zip holds only what is really in the folder`);
  }
}

async function walk(root: string, folder: string): Promise<string[]> {
  const found: string[] = [];
  const visit = async (relative: string) => {
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (!folder && (entry.name.startsWith(".") || entry.name === "node_modules")) continue;
      // Links are never followed, and never skipped silently: the zip would lack files the author expects.
      if (entry.isSymbolicLink()) throw new PackError(`${name} is a link; a module zip holds only what is really in the folder`);
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile()) found.push(name);
    }
  };
  await refuseLinks(root, folder);
  await visit(folder).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
  return found;
}

/** Packs a module folder into a zip signed with the publisher's key, or by Tavora with one it keeps. */
export async function packModule(dir: string, key: KeyObject | Signer): Promise<{ manifest: ModuleManifest; zip: Buffer }> {
  const { manifest, files } = await collectFiles(dir);
  const signer = asSigner(key);
  const hashes = fileHashes(files);
  const manifestFile = files.find((file) => file.name === MANIFEST_FILE)!;
  const zip = writeZip([...files, signatureFile(signer.publicKey, hashes, await signer.signPackage(hashes, manifestFile.data))]);
  if (zip.length > ZIP_LIMITS.maxArchiveBytes) throw new PackError("the zip is bigger than a module zip may be");
  try {
    readZip(zip);
  } catch (error) {
    if (error instanceof ZipError) throw new PackError(`Tavora would refuse this zip: ${error.message}`);
    throw error;
  }
  return { manifest, zip };
}

/** A changelog the manifest names must be there and readable by Tavora, or users would see no patch notes. */
async function checkChangelog(dir: string, name: string): Promise<void> {
  let text: string;
  try {
    const info = await lstat(path.join(dir, name));
    if (!info.isFile()) throw new Error();
    if (info.size > CHANGELOG_LIMITS.maxBytes) throw new PackError(`the changelog ${name} is bigger than ${CHANGELOG_LIMITS.maxBytes / 1024} KB`);
    text = await readFile(path.join(dir, name), "utf8");
  } catch (error) {
    if (error instanceof PackError) throw error;
    throw new PackError(`the changelog ${name} is missing`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new PackError(`the changelog ${name} is not valid JSON`);
  }
  const result = validateChangelog(raw);
  if (!result.ok) throw new PackError(`the changelog ${name} is not valid: ${result.errors.slice(0, 3).join("; ")}`);
}
