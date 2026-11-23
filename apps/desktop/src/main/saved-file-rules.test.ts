// No store can skip a save rule: every file of the user's (saved-versions.ts) has a kind in saved-file.ts, and only
// SavedFile reads and writes one. The pieces it is made of (json.ts readSavedFile and the others, the versions,
// fsutil.ts writeFileAtomic) are used elsewhere only where this file says why.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NOT_SAVED_FILES, SAVED_FILES } from "./saved-file";
import { STORE_VERSIONS, SUPPORTED_VERSIONS } from "./saved-versions";

/** The pieces of the save rules a store would need to keep a file of the user's by hand. */
const RULE_PIECES = ["readSavedFile", "checkSavedFile", "openSealedFile", "keepNewerCopy", "SUPPORTED_VERSIONS", "STORE_VERSIONS"];

/** Who may use those pieces besides SavedFile, and why. */
const USES_RULE_PIECES: Record<string, string> = {
  "json.ts": "the rules themselves, which saved-file.ts puts together",
  "saved-file.ts": "the module that keeps the rules",
  "saved-data.ts": "keepNewerFiles copies aside, at start and before the moves to new names, each data file a newer Tavora wrote; library.json and profile.json move to SavedFile in the next pull request",
  "module-data.ts": "the sweep's hold list: bookkeeping, not in saved-versions.ts",
  "read-only-files.ts": "the version is on each entry (NOT_SAVED_FILES)",
  "cloud-copy.ts": "the cloud copy's files, being changed elsewhere (#909)",
  "cloud-copy-sync.ts": "the cloud copy's files, being changed elsewhere (#909)",
  "workspace.ts": "moves to SavedFile in the next pull request",
  "game-overlays.ts": "moves to SavedFile in the next pull request",
  "storage.ts": "moves to SavedFile in the next pull request",
  "documents.ts": "moves to SavedFile in the next pull request",
  "folder-access.ts": "moves to SavedFile in the next pull request",
  "ai-usage.ts": "moves to SavedFile in the next pull request",
  "host.ts": "ai-usage.json's check; moves to SavedFile in the next pull request",
  "account.ts": "the sealed files; move to SavedFile in the next pull request",
  "account-key.ts": "the sealed files; move to SavedFile in the next pull request",
  "discord-store.ts": "the sealed files; move to SavedFile in the next pull request",
};

/** Who may write a file with writeFileAtomic besides SavedFile, and what it writes: nothing that holds the user's data. */
const WRITES_FILES: Record<string, string> = {
  "fsutil.ts": "writeFileAtomic itself, and the copies keepCopy makes",
  "saved-file.ts": "the module that keeps the rules",
  "saved-data.ts": "window.json (where the window was); library.json, workspace.json and profile.json move to SavedFile in the next pull request",
  "workspace.ts": "moves to SavedFile in the next pull request",
  "workspace-move.ts": "the move to the workspace names at start, after keepNewerFiles, of files that still have the old names",
  "moved-modules.ts": "the moves of renamed modules at start, after keepNewerFiles",
  "game-overlays.ts": "moves to SavedFile in the next pull request",
  "storage.ts": "moves to SavedFile in the next pull request",
  "documents.ts": "the documents' index.json (rebuilt from them); the documents move to SavedFile in the next pull request",
  "folder-access.ts": "moves to SavedFile in the next pull request",
  "host.ts": "ai-usage.json; moves to SavedFile in the next pull request",
  "account.ts": "the sealed files; move to SavedFile in the next pull request",
  "account-key.ts": "the sealed files, and the account vault's cache and seen mark; the sealed files move to SavedFile in the next pull request",
  "discord-store.ts": "the sealed files; move to SavedFile in the next pull request",
  "module-data.ts": "the sweep's hold list: bookkeeping, not in saved-versions.ts",
  "read-only-files.ts": "sources.json, the version on each entry (NOT_SAVED_FILES), and picker.json (a hint)",
  "cloud-copy.ts": "the cloud copy's files, being changed elsewhere (#909)",
  "cloud-copy-sync.ts": "the cloud copy's files, being changed elsewhere (#909)",
  "cloud-copy-swap.ts": "the cloud copy's files, being changed elsewhere (#909)",
  "copy-folder.ts": "the cloud copy's folder, being changed elsewhere (#909)",
  "pairing.ts": "pairing's steps and answers, one pairing at a time",
  "appearance.ts": "a starter theme or style the user makes, in its own folder",
  "module-publish.ts": "a module developer's manifest, changelog and package.json, in their own folder",
  "games-seen.ts": "games-seen.json: when games were seen running",
  "inbox.ts": "inbox.json: which notes were shown",
  "panel-cover.ts": "open-times.json: how fast layouts open here",
  "publisher-names.ts": "publisher-names.json: downloaded",
  "safety-lists.ts": "catalog-lists.json: downloaded",
  "module-folder-check.ts": "module-checks.json: the folders' signature checks, made again when missing",
  "official-key-store.ts": "official-publisher-key.bin: development builds only",
  "icons.ts": "icons, not JSON",
  "hosted-icons.ts": "icons, not JSON",
  "steam-icons.ts": "icons, not JSON",
  "steam-shortcuts.ts": "icons, not JSON",
  "layout-pictures.ts": "pictures, not JSON",
  "profile.ts": "the profile picture, not JSON",
};

/** The names each source file in main/ imports, by file. */
async function importsByFile(): Promise<Map<string, Set<string>>> {
  const found = new Map<string, Set<string>>();
  for (const name of await readdir(__dirname)) {
    if (!name.endsWith(".ts") || name.endsWith(".test.ts") || name.includes("test-helper")) continue;
    const text = await readFile(path.join(__dirname, name), "utf8");
    const names = new Set<string>();
    for (const match of text.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["'][^"']+["']/g)) {
      for (const part of match[1]!.split(",")) {
        const imported = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]!.trim();
        if (imported) names.add(imported);
      }
    }
    // A piece re-exported is a piece used.
    for (const match of text.matchAll(/export\s+\{([^}]*)\}\s*from/g)) for (const part of match[1]!.split(",")) names.add(part.trim().split(/\s+as\s+/)[0]!);
    found.set(name, names);
  }
  return found;
}

describe("the save rules can't be skipped", () => {
  it("every file of the user's has a kind with its version, or says why not", () => {
    const listed = { ...SUPPORTED_VERSIONS, ...STORE_VERSIONS } as Record<string, number>;
    const kinds = SAVED_FILES as Record<string, { version: number }>;
    for (const [name, version] of Object.entries(listed)) {
      expect(name in kinds !== name in NOT_SAVED_FILES, `${name}: a kind in SAVED_FILES or a reason in NOT_SAVED_FILES, not both`).toBe(true);
      if (name in kinds) expect(kinds[name]!.version, name).toBe(version);
    }
    for (const name of [...Object.keys(kinds), ...Object.keys(NOT_SAVED_FILES)]) expect(listed, `${name} is in saved-versions.ts`).toHaveProperty([name]);
  });

  it("only SavedFile uses the pieces of the rules, and those this file names", async () => {
    const users = [...(await importsByFile())].filter(([, names]) => RULE_PIECES.some((piece) => names.has(piece))).map(([file]) => file);
    expect(users.filter((file) => !(file in USES_RULE_PIECES))).toEqual([]);
    // A file that stopped using them leaves the list, so it only ever gets shorter.
    expect(Object.keys(USES_RULE_PIECES).filter((file) => !users.includes(file))).toEqual([]);
  });

  it("only SavedFile writes files with writeFileAtomic, and those this file names, none of them the user's data", async () => {
    const writers = [...(await importsByFile())].filter(([file, names]) => names.has("writeFileAtomic") || (file === "fsutil.ts")).map(([file]) => file);
    expect(writers.filter((file) => !(file in WRITES_FILES))).toEqual([]);
    expect(Object.keys(WRITES_FILES).filter((file) => !writers.includes(file))).toEqual([]);
  });
});
