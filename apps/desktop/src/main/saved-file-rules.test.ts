// No store can skip a save rule by mistake: every file of the user's (saved-versions.ts) has a kind in saved-file.ts,
// only SavedFile reads and writes one, and only with a kind from there. Every other write of a file under main/
// (renames too, as one can put any file in place of the user's, and every call of a function of main/ that writes) is
// listed here, call by call with its paths and what it writes: nothing of it is the user's data, or it says why it
// doesn't move yet. It guards against our own mistakes, not against code written to hide a write: what it follows and
// what it doesn't is in file-writes.test-helper.ts, and file-writes.test.ts shows it.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fileWrites, savedFileKinds } from "./file-writes.test-helper";
import { NOT_SAVED_FILES, SAVED_FILES } from "./saved-file";
import { STORE_VERSIONS, SUPPORTED_VERSIONS } from "./saved-versions";

/** The pieces of the save rules a store would need to keep a file of the user's by hand. */
const RULE_PIECES = ["readSavedFile", "checkSavedFile", "keepNewerCopy", "SUPPORTED_VERSIONS", "STORE_VERSIONS"];

/** Who may use those pieces besides SavedFile, and why. */
const USES_RULE_PIECES: Record<string, string> = {
  "saved-file.ts": "the module that keeps the rules",
  "saved-data.ts": "keepNewerFiles copies aside, at start and before the moves to new names, each data file a newer Tavora wrote",
  "module-data.ts": "the sweep's hold list: bookkeeping, not in saved-versions.ts",
  "read-only-files.ts": "the version is on each entry (NOT_SAVED_FILES)",
};

/**
 * Every write of a file under main/ outside SavedFile's own, by source file (its path under main/): each call as
 * `api(target)`, as many times as it is there, and what it writes. A new write, or one that writes something else, is
 * added here with its reason; one that went leaves, so the list only gets shorter.
 */
const WRITES: { file: string; what: string; calls: string[] }[] = [
  {
    file: "account-key.ts",
    what: "the account vault's seen mark and the vault as last read (not JSON), and the sealed key files moved between slots, never onto a file (the older key file is copied in only where none is; they are written with sealed-file.ts)",
    calls: ["copyFile(legacy, this.options.file)", "rename(slot.keyFile, this.options.file)", "rename(slot.cacheFile, this.options.cacheFile)", "rename(slot.cacheFile, files.cacheFile)", "fsutil.writeFileAtomic(seenFile)", "fsutil.writeFileAtomic(file)", "rename(main.keyFile, files.keyFile)", "rename(main.cacheFile, files.cacheFile)", "rename(place.keyFile, to.keyFile)", "rename(place.cacheFile!, to.cacheFile)"],
  },
  { file: "appearance.ts", what: "a starter theme or style the user makes, in its own folder", calls: ["fsutil.writeFileAtomic(path.join(folder, name))"] },
  { file: "backup.ts", what: "the daily backup: copies of the data files, put in place whole", calls: ["copyFile(path.join(userData, name), path.join(partial, name))", "cp(from, path.join(partial, name, part))", "rename(partial, target)"] },
  { file: "blobs.ts", what: "a module's saved files (blobs), written to a temp and renamed into place", calls: ["open(temp)", "FileHandle.write(handle)", "rename(temp, path.join(dir, name))"] },
  { file: "cloud-copy-swap.ts", what: "writeFlushed: a swap's plan (swap-plan.json) and the note of files lost at a held start (cloud-copy-lost.json), bookkeeping saved-versions.ts names; its status is written with copy-files.ts", calls: ["fsutil.writeFileAtomic(file)"] },
  { file: "cloud-copy-sync.ts", what: "a swap's plan and the note of files lost at a held start (cloud-copy-swap.ts writeFlushed), and the mark that keeps a backup whole: bookkeeping saved-versions.ts names; the cloud copy's own files are written with copy-files.ts", calls: ["cloud-copy-swap.writeFlushed(this.lostNoteFile)", "cloud-copy-swap.writeFlushed(this.planFile)", "cloud-copy-swap.writeFlushed(this.planFile)", "fsutil.writeFileAtomic(path.join(dir, KEEP_WHOLE))"] },
  {
    file: "cloud-copy-sync.ts",
    what: "the swap itself: this PC's data and the copy's moved between their places, the staging folder and the backup (cloud-copy.ts), and the state moved, as it is, to cloud-copy-swapping.json while a swap or a question goes on, and back only where no cloud-copy.json is",
    calls: ["cloud-copy.sortWrittenSince(plan.keepIn)", "cloud-copy.sortWrittenSince(plan.keepIn)", "cloud-copy.swapInCopy(this.stagedData)", "cloud-copy.undoSwap(this.stagedData)", "cloud-copy.undoSwap(this.stagedData)", "rename-held.renameHeld(incoming, this.stagedData)", "rename-held.renameHeld(this.parkedFile, this.stateFile)", "rename-held.renameHeld(this.stagedData, backup)", "rename-held.renameHeld(this.stagedData, backup)", "rename-held.renameHeld(this.stateFile, this.parkedFile)"],
  },
  { file: "cloud-copy-sync.ts", what: "the library a copy brought, with this PC's own settings put back in it once, before anything reads it (keepPcSettings): every other field as the copy wrote it", calls: ["fsutil.writeFileAtomic(file)"] },
  { file: "cloud-copy-sync.ts", what: "a probe that the folder the user picks for the copy can be written (copy-folder.ts)", calls: ["copy-folder.checkFolder(folder)", "copy-folder.checkFolder(folder)"] },
  { file: "cloud-copy.ts", what: "a download into the staging folder, and the swap's moves of this PC's data, the copy's and the backup; its state is written with copy-files.ts", calls: ["writeFile(path.join(partsDir, id))", "open(target)", "FileHandle.writeFile(out)", "rename-held.renameHeld(from, to)", "cp(from, part)", "rename-held.renameHeld(part, to)", "rename-held.renameHeld(from, done)"] },
  { file: "copy-folder.ts", what: "the cloud copy's folder: its manifests and parts, and a probe that it can be written; cloud-copy-unused.json is written with copy-files.ts", calls: ["fsutil.writeFileAtomic(file)", "writeFile(probe)"] },
  { file: "crash-log.ts", what: "crashes.log, through diagnostics.ts", calls: ["diagnostics.appendLogLine(file)"] },
  { file: "development-folders.ts", what: "an example module copied into the developer's own folder", calls: ["example-copy.copyExample(example.root)"] },
  { file: "diagnostics.ts", what: "the crash and start logs", calls: ["writeFileSync(file)"] },
  { file: "documents.ts", what: "the documents' index.json, rebuilt from them, set aside when damaged", calls: ["json.readJsonOrSetAside(this.indexFile)", "fsutil.writeFileAtomic(this.indexFile)"] },
  { file: "example-copy.ts", what: "an example module copied into the developer's own folder", calls: ["writeFile(to)", "copyFile(path.join(source, file), to)", "writeFile(path.join(target, \".gitignore\"))"] },
  { file: "file-dialogs.ts", what: "a file the user saves from a module, where they chose in the save dialog", calls: ["writeFile(file)"] },
  { file: "fsutil.ts", what: "writeFileAtomic itself (a temp, then renamed into place), and the copies keepCopy makes", calls: ["open(temp)", "FileHandle.writeFile(handle)", "rename-held.renameHeld(temp, file)"] },
  { file: "game-icons.ts", what: "game icons, imported and synced: not JSON", calls: ["icons.importIcon(this.iconDir)", "icon-sync.syncIcons({\u2026})"] },
  { file: "game-overlays.ts", what: "the backup of game-overlays.json before the move to setups", calls: ["fsutil.keepCopy(path.join(backupsDir(userData), BEFORE_SETUPS_DIR), GAME_OVERLAYS_FILE)"] },
  { file: "games-seen.ts", what: "games-seen.json: when games were seen running", calls: ["fsutil.writeFileAtomic(this.file)"] },
  { file: "host.ts", what: "updates.log", calls: ["appendFile(path.join(this.options.userData, \"updates.log\"))"] },
  { file: "host.ts", what: "the start's own steps, each listed in its module: the moves to new names and of renamed modules, module data's migration and sweep, recovering installs, the daily backup and the crash log", calls: ["workspace-move.moveToWorkspaces(userData)", "installer.recoverInstalls({\u2026})", "module-data.migrateModuleData(userData)", "moved-modules.moveOfficialModules(userData)", "module-data.holdLeftovers(userData)", "backup.backupData({\u2026})", "crash-log.recordCrash({\u2026})"] },
  { file: "hosted-icons.ts", what: "icons, not JSON", calls: ["fsutil.writeFileAtomic(path.join(iconDir, file))"] },
  { file: "icon-sync.ts", what: "game icons from Steam, its shortcuts and the service: not JSON", calls: ["steam-icons.saveExeIcon(iconDir)", "steam-icons.saveSteamIcon(iconDir)", "steam-shortcuts.saveShortcutIcon(iconDir)", "hosted-icons.saveHostedIcon(iconDir)", "steam-icons.saveLibraryCacheIcon(iconDir)", "steam-icons.savePublicSteamIcon(iconDir)", "steam-icons.saveLibraryCacheIcon(iconDir)"] },
  { file: "icons.ts", what: "icons, not JSON", calls: ["fsutil.writeFileAtomic(path.join(iconDir, file))"] },
  { file: "inbox.ts", what: "inbox.json: which notes were shown", calls: ["fsutil.writeFileAtomic(this.o.file)"] },
  { file: "index.ts", what: "the crash log and the start failure's report", calls: ["startup-failure.reportStartupFailure(userData)", "crash-log.recordCrash({\u2026})", "startup-failure.reportStartupFailure(userData)"] },
  { file: "installer.ts", what: "a module's files from its zip, the install's own markers, and its folders moved into place", calls: ["open(destination)", "FileHandle.writeFile(handle)", "writeFile(`${old}${UPDATING}`)", "rename-held.renameHeld(target, old)", "rename-held.renameHeld(staging, target)", "rename-held.renameHeld(old, target)", "rename-held.renameHeld(staging, target)", "writeFile(`${old}${DONE}`)", "writeFile(path.join(stagingRoot, `${REMOVED}${moduleId}`))", "rename-held.renameHeld(old, path.join(stagingRoot, path.basename(old).replace(/^old-/, \"left-\")))", "rename-held.renameHeld(old, target)", "rename-held.renameHeld(target, unfinished)", "rename-held.renameHeld(old, target)", "rename-held.renameHeld(unfinished, target)"] },
  { file: "json.ts", what: "the rules' copies aside: a damaged file renamed to `.corrupt-<time>`, and the `.corrupt` and `.from-version-<n>` copies", calls: ["rename(file, target)", "fsutil.keepCopyAt(path.dirname(file), `${path.basename(file)}.corrupt`)", "fsutil.keepCopy(path.dirname(file), `${path.basename(file)}.from-version-${version}`)"] },
  { file: "layout-pictures.ts", what: "pictures, not JSON", calls: ["fsutil.writeFileAtomic(this.file(gameId))"] },
  { file: "module-data.ts", what: "the sweep's hold list: bookkeeping, not in saved-versions.ts", calls: ["json.keepNewerCopy(file)", "json.setAside(file)", "fsutil.writeFileAtomic(file)"] },
  { file: "module-data.ts", what: "module data and browser storage folders moved to another owner or workspace", calls: ["rename(path.join(dataRoot, name), target)", "rename(path.join(partitions, name), target)", "rename(path.join(from, workspace), target)", "rename(path.join(partitions, name), target)"] },
  { file: "module-files-folder.ts", what: "a module's files moved to the module files folder the user picked", calls: ["module-files.filesTarget(folder)", "module-files.copyStoredFiles(old)", "module-files.copyStoredFiles(from)"] },
  { file: "module-files.ts", what: "a probe of the module files folder, and a module's files moved to a new one", calls: ["writeFile(probe)", "copyFile(fileAt(from, file), part)", "rename(part, target)"] },
  { file: "module-folder-check.ts", what: "module-checks.json: the folders' signature checks, made again when missing", calls: ["fsutil.writeFileAtomic(this.file)"] },
  { file: "module-lifecycle.ts", what: "module installs from a zip, and old copies dropped", calls: ["installer.installZipData(zip)", "installer.installZip(file)", "installer.installZipData(zip)", "installer.dropOldCopies(this.options.userData)"] },
  { file: "module-publish.ts", what: "a module developer's manifest, changelog and package.json, in their own folder", calls: ["fsutil.writeFileAtomic(file)", "fsutil.writeFileAtomic(manifestFile)", "fsutil.writeFileAtomic(pkgFile)", "fsutil.writeFileAtomic(file)"] },
  { file: "module-view.ts", what: "the crash log", calls: ["crash-log.recordCrash({\u2026})"] },
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
  { file: "saved-file.ts", what: "the module that keeps the rules: its writes, the write at quit through `<file>.now`, a file its kind can't use set aside, or copied aside where its kind leaves it in place", calls: ["openSync(now)", "writeSync(handle)", "renameSync(now, file)", "json.checkSavedFile(this.file)", "json.keepDamagedCopy(this.file)", "json.setAside(this.file)", "fsutil.writeFileUnlessReplaced(this.file)"] },
  {
    file: "sealed-file.ts",
    what: "a copy of a sealed file whose data doesn't open here (`.unopened`), left in place for the next start; and a sign-in that can't be read moved aside (`.held-<time>`, never onto a file) when the user signs in or out",
    calls: ["fsutil.keepCopy(path.dirname(this.file), `${path.basename(this.file)}.unopened`)", "rename(this.file, target)"],
  },
  { file: "startup-failure.ts", what: "startup.log, through diagnostics.ts", calls: ["diagnostics.appendStartupLog(log)"] },
  { file: "steam-icons.ts", what: "icons, not JSON", calls: ["fsutil.writeFileAtomic(path.join(iconDir, file))", "fsutil.writeFileAtomic(path.join(iconDir, file))", "fsutil.writeFileAtomic(path.join(iconDir, file))", "fsutil.writeFileAtomic(path.join(iconDir, file))", "fsutil.writeFileAtomic(path.join(iconDir, file))"] },
  { file: "steam-shortcuts.ts", what: "icons, not JSON", calls: ["fsutil.writeFileAtomic(path.join(iconDir, file))"] },
  { file: "storage.ts", what: "a panel's state file moved aside, for the owner that wrote it, when another owner's page writes", calls: ["rename(file, this.asideFile(instanceId, other))"] },
  { file: "update-freshness.ts", what: "update-feed.json: the newest time a signed update feed was seen at (bookkeeping saved-versions.ts names)", calls: ["fsutil.writeFileAtomic(this.file)"] },
  { file: "user-profile.ts", what: "the profile picture, not JSON", calls: ["profile.savePicture(dir)", "profile.savePicture(dir)"] },
  { file: "workspace-move.ts", what: "the move to the workspace names at start, after keepNewerFiles, of files that still have the old names, and their backup", calls: ["fsutil.keepCopy(backup, name)", "fsutil.writeFileAtomic(path.join(userData, name))"] },
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
/** Reading every source of main/ takes a few seconds, more on a busy machine. */
const READS_ALL = 60_000;

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
  }, READS_ALL);

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
    for (const [name, writes] of fileWrites(await sources())) if (writes.length) found[name] = sorted(writes);
    const listed: Record<string, string[]> = {};
    for (const { file, calls } of WRITES) listed[file] = sorted([...(listed[file] ?? []), ...calls]);
    expect(found).toEqual(listed);
  }, READS_ALL);
});
