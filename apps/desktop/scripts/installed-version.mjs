// The version of an installed Tavora, read from the package.json inside its resources\app.asar (the app is packed into
// app.asar, so the OnlyLoadAppFromAsar and asar integrity fuses can hold). Used by `pnpm release` and update-check.mjs.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import asar from "@electron/asar";

/** The version in `<installDir>\resources\app.asar`'s package.json, or null when there is none to read. */
export function installedVersion(installDir) {
  const archive = path.join(installDir, "resources", "app.asar");
  try {
    if (!existsSync(archive)) {
      // Tavora up to 0.24.x shipped its app unpacked, as resources\app.
      return JSON.parse(readFileSync(path.join(installDir, "resources", "app", "package.json"), "utf8")).version ?? null;
    }
    // @electron/asar keeps the archive's header; an update replaces the file, so read it fresh each time.
    asar.uncache(archive);
    return JSON.parse(asar.extractFile(archive, "package.json").toString("utf8")).version ?? null;
  } catch {
    return null;
  }
}
