// `pnpm check:patches`: every dependency in pnpm-workspace.yaml's patchedDependencies is really patched in
// node_modules. pnpm can report an install as done while a .pnpm folder still holds the unpatched files (the
// 0.23.9 dry run: Excalidraw without Tavora's patch). Runs in CI right after `pnpm install` and in `pnpm check`.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * The lines each patch adds, per file: { "dist/dev/index.js": ["// Tavora: …", …] }. Blank lines and
 * whitespace-only differences are left out, so only lines that prove the patch is there are checked.
 */
export function addedLines(patch) {
  const files = {};
  let current = null;
  for (const line of patch.split(/\r?\n/)) {
    const target = /^\+\+\+ b\/(.+)$/.exec(line);
    if (target) {
      current = files[target[1]] ??= [];
      continue;
    }
    if (line.startsWith("diff --git ")) current = null;
    else if (current && line.startsWith("+") && line.slice(1).trim()) current.push(line.slice(1).trim());
  }
  return files;
}

/**
 * The .pnpm folders that hold `name@version`. pnpm writes "@scope/pkg" as "@scope+pkg" and shortens long folder
 * names with a hash ("@excalidraw+excalidraw@0.18_d18653…" on Windows), so each candidate's package.json decides.
 */
export function storeFolders(store, entries, name, version) {
  const prefix = `${name.replace("/", "+")}@`;
  return entries.filter((entry) => {
    if (!entry.startsWith(prefix)) return false;
    try {
      return JSON.parse(readFileSync(path.join(store, entry, "node_modules", name, "package.json"), "utf8")).version === version;
    } catch {
      return false;
    }
  });
}

/**
 * The `patchedDependencies:` map of a pnpm-workspace.yaml: { "@scope/pkg@1.2.3": "patches/pkg.patch" }. Reads only
 * that block (one `key: value` line per patch, quoted or not), so no YAML library is needed.
 */
export function patchedDependencies(yaml) {
  const patched = {};
  let inside = false;
  for (const line of yaml.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      inside = /^patchedDependencies:\s*$/.test(line);
      continue;
    }
    const entry = inside && /^\s+(?:"([^"]+)"|'([^']+)'|([^\s:"'][^:]*?)):\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s*$/.exec(line);
    if (entry) patched[entry[1] ?? entry[2] ?? entry[3]] = entry[4] ?? entry[5] ?? entry[6];
  }
  return patched;
}

/** "@scope/pkg@1.2.3" → { name: "@scope/pkg", version: "1.2.3" }. */
export function parseSpec(spec) {
  const at = spec.lastIndexOf("@");
  return at > 0 ? { name: spec.slice(0, at), version: spec.slice(at + 1) } : { name: spec, version: "" };
}

/** What is wrong with the patched dependencies under `root`. Empty means every copy is patched. */
export function checkPatches(root) {
  const workspace = path.join(root, "pnpm-workspace.yaml");
  const patched = existsSync(workspace) ? patchedDependencies(readFileSync(workspace, "utf8")) : {};
  const store = path.join(root, "node_modules", ".pnpm");
  const entries = existsSync(store) ? readdirSync(store) : [];
  const problems = [];
  for (const [spec, patchFile] of Object.entries(patched)) {
    const { name, version } = parseSpec(spec);
    const folders = storeFolders(store, entries, name, version);
    if (folders.length === 0) {
      problems.push(`${spec} is not installed (not in node_modules/.pnpm). Run pnpm install --frozen-lockfile.`);
      continue;
    }
    const files = addedLines(readFileSync(path.join(root, patchFile), "utf8"));
    for (const folder of folders) {
      const missing = Object.entries(files).filter(([file, lines]) => {
        const installed = path.join(store, folder, "node_modules", name, file);
        if (!existsSync(installed)) return true;
        const text = new Set(readFileSync(installed, "utf8").split(/\r?\n/).map((line) => line.trim()));
        return lines.some((line) => !text.has(line));
      });
      if (missing.length) {
        problems.push(
          `${spec} is not patched in node_modules/.pnpm/${folder} (${missing.map(([file]) => file).join(", ")}). ` +
            `Delete that folder and run pnpm install --frozen-lockfile.`,
        );
      }
    }
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const problems = checkPatches(root);
  if (problems.length) {
    console.error("Patched dependencies are not patched:");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log("Every patched dependency is patched.");
}
