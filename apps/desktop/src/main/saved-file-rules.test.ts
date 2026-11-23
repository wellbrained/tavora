// No store can skip a save rule: every file of the user's (saved-versions.ts) has a kind in saved-file.ts, only
// SavedFile reads and writes one, and only with a kind from there. Every other write of a file under main/ (renames
// too, as one can put any file in place of the user's) is listed here, call by call with its target and what it writes:
// nothing of it is the user's data, or it says why it doesn't move yet. The sources are read with TypeScript's own
// parser (file-writes.test-helper.ts), so a renamed import, a module used as a whole or a file handle is followed.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fileWrites, savedFileKinds } from "./file-writes.test-helper";
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

/**
 * Every write of a file under main/ outside SavedFile's own, by source file (its path under main/): each call as
 * `api(target)`, as many times as it is there, and what it writes. A new write, or one that writes something else, is
 * added here with its reason; one that went leaves, so the list only gets shorter.
 */
const WRITES: { file: string; what: string; calls: string[] }[] = [
  { file: "account-key.ts", what: "the account vault's seen mark and cache, and the sealed key files moved between slots (NOT_SAVED_FILES)", calls: ["rename(legacy, this.options.file)", "rename(slot.keyFile, this.options.file)", "rename(slot.cacheFile, this.options.cacheFile)", "rename(slot.cacheFile, files.cacheFile)", "fsutil.writeFileAtomic(seenFile)", "fsutil.writeFileAtomic(file)", "rename(main.keyFile, files.keyFile)", "rename(main.cacheFile, files.cacheFile)", "rename(place.keyFile, to.keyFile)", "rename(place.cacheFile!, to.cacheFile)", "fsutil.writeFileAtomic(place.keyFile)"] },
  { file: "account.ts", what: "account.json, sealed (NOT_SAVED_FILES)", calls: ["fsutil.writeFileAtomic(file)"] },
  { file: "appearance.ts", what: "a starter theme or style the user makes, in its own folder", calls: ["fsutil.writeFileAtomic(path.join(folder, name))"] },
  { file: "backup.ts", what: "the daily backup: copies of the data files, put in place whole", calls: ["copyFile(path.join(userData, name), path.join(partial, name))", "cp(from, path.join(partial, name, part))", "rename(partial, target)"] },
  { file: "blobs.ts", what: "a module's saved files (blobs), written to a temp and renamed into place", calls: ["open(temp)", "FileHandle.write(handle)", "rename(temp, path.join(dir, name))"] },
  { file: "cloud-copy-swap.ts", what: "the cloud copy's files, being changed elsewhere (#909)", calls: ["fsutil.writeFileAtomic(file)"] },
  { file: "cloud-copy-sync.ts", what: "the cloud copy's files, being changed elsewhere (#909)", calls: ["fsutil.writeFileAtomic(this.listFile)", "fsutil.writeFileAtomic(path.join(dir, KEEP_WHOLE))", "rename-held.renameHeld(this.stateFile, this.parkedFile)", "rename-held.renameHeld(this.parkedFile, this.stateFile)", "rename-held.renameHeld(this.stagedData, backup)", "rename-held.renameHeld(this.stagedData, backup)", "rename-held.renameHeld(incoming, this.stagedData)", "fsutil.writeFileAtomic(this.listFile)", "fsutil.writeFileAtomic(file)", "fsutil.writeFileAtomic(file)"] },
  { file: "cloud-copy.ts", what: "the cloud copy's files, being changed elsewhere (#909)", calls: ["writeFile(path.join(partsDir, id))", "open(target)", "FileHandle.writeFile(out)", "rename-held.renameHeld(from, to)", "cp(from, part)", "rename-held.renameHeld(part, to)", "rename-held.renameHeld(from, done)", "fsutil.writeFileAtomic(file)"] },
  { file: "copy-folder.ts", what: "the cloud copy's folder, being changed elsewhere (#909)", calls: ["fsutil.writeFileAtomic(file)", "writeFile(probe)"] },
  { file: "diagnostics.ts", what: "the crash and diagnostics log", calls: ["writeFileSync(file)"] },
  { file: "discord-store.ts", what: "discord.json, sealed (NOT_SAVED_FILES)", calls: ["fsutil.writeFileAtomic(file)"] },
  { file: "documents.ts", what: "the documents' index.json, rebuilt from them, set aside when damaged", calls: ["json.readJsonOrSetAside(this.indexFile)", "fsutil.writeFileAtomic(this.indexFile)"] },
  { file: "documents.ts", what: "the documents; move to SavedFile in the next pull request", calls: ["fsutil.writeFileAtomic(this.file(docId))"] },
  { file: "example-copy.ts", what: "an example module copied into the developer's own folder", calls: ["writeFile(to)", "copyFile(path.join(source, file), to)", "writeFile(path.join(target, \".gitignore\"))"] },
  { file: "file-dialogs.ts", what: "a file the user saves from a module, where they chose in the save dialog", calls: ["writeFile(file)"] },
  { file: "folder-access.ts", what: "folders.json; moves to SavedFile in the next pull request", calls: ["fsutil.writeFileAtomic(this.file)"] },
  { file: "fsutil.ts", what: "writeFileAtomic itself (a temp, then renamed into place), and the copies keepCopy makes", calls: ["open(temp)", "FileHandle.writeFile(handle)", "rename-held.renameHeld(temp, file)"] },
  { file: "game-overlays.ts", what: "the backup of game-overlays.json before the move to setups", calls: ["fsutil.keepCopy(path.join(backupsDir(userData), BEFORE_SETUPS_DIR), GAME_OVERLAYS_FILE)"] },
  { file: "game-overlays.ts", what: "game-overlays.json; moves to SavedFile in the next pull request", calls: ["fsutil.writeFileAtomic(this.file)"] },
  { file: "games-seen.ts", what: "games-seen.json: when games were seen running", calls: ["fsutil.writeFileAtomic(this.file)"] },
  { file: "host.ts", what: "updates.log, and ai-usage.json (NOT_SAVED_FILES)", calls: ["appendFile(path.join(this.options.userData, \"updates.log\"))", "fsutil.writeFileAtomic(file)"] },
  { file: "hosted-icons.ts", what: "icons, not JSON", calls: ["fsutil.writeFileAtomic(path.join(iconDir, file))"] },
  { file: "icons.ts", what: "icons, not JSON", calls: ["fsutil.writeFileAtomic(path.join(iconDir, file))"] },
  { file: "inbox.ts", what: "inbox.json: which notes were shown", calls: ["fsutil.writeFileAtomic(this.o.file)"] },
  { file: "installer.ts", what: "a module's files from its zip, the install's own markers, and its folders moved into place", calls: ["open(destination)", "FileHandle.writeFile(handle)", "writeFile(`${old}${UPDATING}`)", "rename-held.renameHeld(target, old)", "rename-held.renameHeld(staging, target)", "rename-held.renameHeld(old, target)", "rename-held.renameHeld(staging, target)", "writeFile(`${old}${DONE}`)", "writeFile(path.join(stagingRoot, `${REMOVED}${moduleId}`))", "rename-held.renameHeld(old, path.join(stagingRoot, path.basename(old).replace(/^old-/, \"left-\")))", "rename-held.renameHeld(old, target)", "rename-held.renameHeld(target, unfinished)", "rename-held.renameHeld(old, target)", "rename-held.renameHeld(unfinished, target)"] },
  { file: "json.ts", what: "the rules' copies aside: a damaged file renamed to `.corrupt-<time>`, and the `.corrupt`, `.from-version-<n>` and `.unopened` copies", calls: ["rename(file, target)", "fsutil.keepCopyAt(path.dirname(file), `${path.basename(file)}.corrupt`)", "fsutil.keepCopy(path.dirname(file), `${path.basename(file)}.from-version-${version}`)", "fsutil.keepCopy(path.dirname(file), `${path.basename(file)}.unopened`)"] },
  { file: "layout-pictures.ts", what: "pictures, not JSON", calls: ["fsutil.writeFileAtomic(this.file(gameId))"] },
  { file: "module-data.ts", what: "the sweep's hold list: bookkeeping, not in saved-versions.ts", calls: ["json.keepNewerCopy(file)", "json.setAside(file)", "fsutil.writeFileAtomic(file)"] },
  { file: "module-data.ts", what: "module data and browser storage folders moved to another owner or workspace", calls: ["rename(path.join(dataRoot, name), target)", "rename(path.join(partitions, name), target)", "rename(path.join(from, workspace), target)", "rename(path.join(partitions, name), target)"] },
  { file: "module-files.ts", what: "a probe of the module files folder, and a module's files moved to a new one", calls: ["writeFile(probe)", "copyFile(fileAt(from, file), part)", "rename(part, target)"] },
  { file: "module-folder-check.ts", what: "module-checks.json: the folders' signature checks, made again when missing", calls: ["fsutil.writeFileAtomic(this.file)"] },
  { file: "module-publish.ts", what: "a module developer's manifest, changelog and package.json, in their own folder", calls: ["fsutil.writeFileAtomic(file)", "fsutil.writeFileAtomic(manifestFile)", "fsutil.writeFileAtomic(pkgFile)", "fsutil.writeFileAtomic(file)"] },
  { file: "moved-modules.ts", what: "the moves of renamed modules at start, after keepNewerFiles: their saved files, data folders and browser storage", calls: ["rename(path.join(source, game), target)", "rename(path.join(partitions, name), target)", "fsutil.writeFileAtomic(file)"] },
  { file: "official-key-store.ts", what: "official-publisher-key.bin: development builds only", calls: ["fsutil.writeFileAtomic(this.file)"] },
  { file: "official-publish.ts", what: "the official publishes' log, and a manifest in the developer's own folder", calls: ["appendFile(path.join(this.options.userData, \"official-publishes.log\"))", "writeFile(file)"] },
  { file: "pairing.ts", what: "pairing's steps and pairing-answers.json, one pairing at a time", calls: ["fsutil.writeFileAtomic(file)", "fsutil.writeFileAtomic(this.file(id, step))"] },
  { file: "panel-cover.ts", what: "open-times.json: how fast layouts open here, set aside when damaged", calls: ["json.readJsonOrSetAside(this.file)", "fsutil.writeFileAtomic(this.file)"] },
  { file: "profile.ts", what: "the profile picture, not JSON", calls: ["fsutil.writeFileAtomic(path.join(dir, file))"] },
  { file: "publisher-names.ts", what: "publisher-names.json: downloaded, set aside when damaged", calls: ["json.readJsonOrSetAside(this.options.file)", "fsutil.writeFileAtomic(this.options.file)"] },
  { file: "read-only-files.ts", what: "sources.json, the version on each entry (NOT_SAVED_FILES), and picker.json (a hint)", calls: ["json.keepNewerCopy(this.file)", "json.setAside(this.file)", "fsutil.writeFileAtomic(this.file)", "fsutil.writeFileAtomic(path.join(path.dirname(this.file), 'picker.json'))"] },
  { file: "rename-held.ts", what: "renameHeld itself", calls: ["rename(from, to)", "rename(from, to)"] },
  { file: "safety-lists.ts", what: "catalog-lists.json: downloaded, set aside when damaged", calls: ["json.readJsonOrSetAside(this.options.file)", "fsutil.writeFileAtomic(this.options.file)"] },
  { file: "saved-data.ts", what: "window.json (where the window was), set aside when damaged", calls: ["json.readJsonOrSetAside(this.file(WINDOW_FILE))", "fsutil.writeFileAtomic(this.file(WINDOW_FILE))"] },
  { file: "saved-data.ts", what: "keepNewerFiles: a copy of each data file a newer Tavora wrote; and a profile without a usable id set aside", calls: ["json.keepNewerCopy(file)", "json.setAside(file)"] },
  { file: "saved-data.ts", what: "library.json and profile.json; move to SavedFile in the next pull request", calls: ["fsutil.writeFileAtomic(this.file(LIBRARY_FILE))", "fsutil.writeFileAtomic(this.file(PROFILE_FILE))"] },
  { file: "saved-file.ts", what: "the module that keeps the rules: its writes, and the write at quit through `<file>.now`", calls: ["writeFileSync(now)", "renameSync(now, file)", "fsutil.writeFileUnlessReplaced(this.file)"] },
  { file: "steam-icons.ts", what: "icons, not JSON", calls: ["fsutil.writeFileAtomic(path.join(iconDir, file))", "fsutil.writeFileAtomic(path.join(iconDir, file))", "fsutil.writeFileAtomic(path.join(iconDir, file))", "fsutil.writeFileAtomic(path.join(iconDir, file))", "fsutil.writeFileAtomic(path.join(iconDir, file))"] },
  { file: "steam-shortcuts.ts", what: "icons, not JSON", calls: ["fsutil.writeFileAtomic(path.join(iconDir, file))"] },
  { file: "storage.ts", what: "module settings and panel state; move to SavedFile in the next pull request", calls: ["fsutil.writeFileAtomic(this.file)", "fsutil.writeFileAtomic(file)", "fsutil.writeFileAtomic(file)"] },
  { file: "storage.ts", what: "a panel's state file moved aside, for the owner that wrote it, when another owner's page writes", calls: ["rename(file, this.asideFile(instanceId, other))"] },
  { file: "workspace-move.ts", what: "the move to the workspace names at start, after keepNewerFiles, of files that still have the old names, and their backup", calls: ["fsutil.keepCopy(backup, name)", "fsutil.writeFileAtomic(path.join(userData, name))"] },
  { file: "workspace.ts", what: "workspace.json; moves to SavedFile in the next pull request", calls: ["fsutil.writeFileAtomic(file)"] },
];

/** Every source under main/, folders in it too, by its path there (with `/`). */
async function sources(): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts") && !entry.name.includes("test-helper")) {
        found.set(path.relative(__dirname, full).split(path.sep).join("/"), await readFile(full, "utf8"));
      }
    }
  };
  await walk(__dirname);
  return found;
}

/** The names a source imports from Tavora's own modules, renamed ones by the name they have there. */
function importedNames(text: string): Set<string> {
  const names = new Set<string>();
  for (const match of text.matchAll(/(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["'][^"']+["']/g)) {
    for (const part of match[1]!.split(",")) {
      const imported = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]!.trim();
      if (imported) names.add(imported);
    }
  }
  return names;
}

const sorted = (calls: readonly string[]) => [...calls].sort();

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

  it("every SavedFile is made with a kind from SAVED_FILES, and none is made otherwise", async () => {
    let made = 0;
    for (const [name, text] of await sources()) {
      const { kinds, extended } = savedFileKinds(name, text);
      expect(extended, `${name} extends SavedFile`).toBe(false);
      for (const kind of kinds) expect(kind, `${name}: new SavedFile(…, ${kind})`).toMatch(/^SAVED_FILES(\.[\w$]+|\[[^\]]+\])$/);
      made += kinds.length;
    }
    expect(made).toBeGreaterThan(0);
  });

  it("only SavedFile uses the pieces of the rules, and those this file names", async () => {
    const users = [...(await sources())].filter(([, text]) => RULE_PIECES.some((piece) => importedNames(text).has(piece))).map(([file]) => file);
    expect(users.filter((file) => !(file in USES_RULE_PIECES))).toEqual([]);
    // A file that stopped using them leaves the list, so it only ever gets shorter.
    expect(Object.keys(USES_RULE_PIECES).filter((file) => !users.includes(file))).toEqual([]);
  });

  it("Tavora's own file modules are only imported by name, so every use of them is seen", async () => {
    const whole = /import\s+(?:\*\s+as\s+[\w$]+|[\w$]+(?:\s*,\s*\{[^}]*\})?)\s+from\s*["'](?:\.\.?\/)+(?:fsutil|json|saved-versions|saved-file|rename-held)["']/;
    expect([...(await sources())].filter(([, text]) => whole.test(text)).map(([file]) => file)).toEqual([]);
  });

  it("every other write of a file is one this file names, with what it writes", async () => {
    const found: Record<string, string[]> = {};
    for (const [name, text] of await sources()) {
      const writes = fileWrites(name, text);
      if (writes.length) found[name] = sorted(writes);
    }
    const listed: Record<string, string[]> = {};
    for (const { file, calls } of WRITES) listed[file] = sorted([...(listed[file] ?? []), ...calls]);
    expect(found).toEqual(listed);
  });
});
