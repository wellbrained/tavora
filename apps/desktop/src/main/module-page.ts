// What an installed module's page shows from its own files (the same layout as a catalog page, built
// without the catalog): its readme as plain text blocks and its screenshots. Both files are named by
// the manifest and resolved inside the module's folder like any asset, so nothing outside it is read.
// Pictures must be PNG or WebP (module-icon.ts); the readme is shown as text only (catalog-readme.ts).
import { open, readFile, stat } from "node:fs/promises";
import { MAX_README_BYTES, MAX_SCREENSHOT_BYTES, MAX_SCREENSHOTS, type ModuleManifest } from "@tavora/module-schema";
import type { ReadmeBlock } from "../shared/host-api";
import { resolveAsset } from "./assets";
import { parseReadme } from "./catalog-readme";
import { pictureDataUrl } from "./module-icon";

/** The readme a module without a `readme` in its manifest may still have. */
const DEFAULT_README = "README.md";

/** The readme as plain text blocks, or an empty list when there is none, it is out of the folder or unreadable. At most MAX_README_BYTES are read. */
export async function readModuleReadme(root: string, file: string | undefined): Promise<ReadmeBlock[]> {
  if (root === "") return [];
  try {
    const resolved = await resolveAsset(root, `/${file ?? DEFAULT_README}`);
    if (!resolved || (await stat(resolved)).size === 0) return [];
    const handle = await open(resolved, "r");
    try {
      const buffer = Buffer.alloc(MAX_README_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, MAX_README_BYTES, 0);
      return parseReadme(buffer.toString("utf8", 0, bytesRead));
    } finally {
      await handle.close();
    }
  } catch {
    return [];
  }
}

/** The manifest's screenshots that are small PNG or WebP files inside the folder, in order; the rest are left out. */
export async function readModuleScreenshots(root: string, files: string[] | undefined): Promise<string[]> {
  if (root === "" || !files) return [];
  const shots = await Promise.all(
    files.slice(0, MAX_SCREENSHOTS).map(async (file) => {
      try {
        const resolved = await resolveAsset(root, `/${file}`);
        if (!resolved || (await stat(resolved)).size > MAX_SCREENSHOT_BYTES) return null;
        return pictureDataUrl(await readFile(resolved), MAX_SCREENSHOT_BYTES);
      } catch {
        return null;
      }
    }),
  );
  return shots.filter((url): url is string => url !== null);
}

/** A module's page from its own folder. */
export async function readModulePage(root: string, manifest: Pick<ModuleManifest, "readme" | "screenshots">) {
  const [readme, screenshots] = await Promise.all([readModuleReadme(root, manifest.readme), readModuleScreenshots(root, manifest.screenshots)]);
  return { readme, screenshots };
}
