// No store can skip a save rule: every file of the user's (saved-versions.ts) has a kind in saved-file.ts, only
// SavedFile reads and writes one, and only with a kind from there. Every other write of a file in main/ is listed
// here, call by call, with what it writes: nothing of it is the user's data, or it says why it doesn't move yet.
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

/** The calls that write a file: Node's, and fsutil.ts's own. */
const WRITE_CALLS = /(?<![\w$])(writeFileAtomic|writeFileUnlessReplaced|writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream|copyFileSync|copyFile|cpSync|cp|keepCopyAt|keepCopy)\s*\(/g;

/**
 * Every write of a file in main/ outside SavedFile's own, by source file: each call as `api(first argument)`, as many
 * times as it is there, and what it writes. A new write, or one that writes something else, is added here with its reason.
 */
const WRITES: Record<string, { calls: string[]; what: string }> = {
  "saved-file.ts": { calls: ["writeFileSync(now)", "writeFileUnlessReplaced(this.file)", "writeFileAtomic(this.file)"], what: "the module that keeps the rules" },
  "fsutil.ts": { calls: ["writeFileUnlessReplaced(file)", "writeFile(body)", "keepCopyAt(dir)", "writeFileAtomic(target)"], what: "writeFileAtomic itself, and the copies keepCopy makes" },
  "json.ts": { calls: ["keepCopyAt(path.dirname(file))", "keepCopy(path.dirname(file))", "keepCopy(path.dirname(file))"], what: "the copies the rules keep aside (`.corrupt`, `.from-version-<n>`, `.unopened`)" },
  "saved-data.ts": {
    calls: ["writeFileAtomic(this.file(LIBRARY_FILE))", "writeFileAtomic(this.file(PROFILE_FILE))", "writeFileAtomic(this.file(WINDOW_FILE))"],
    what: "window.json (where the window was); library.json and profile.json move to SavedFile in the next pull request",
  },
  "workspace.ts": { calls: ["writeFileAtomic(file)"], what: "workspace.json; moves to SavedFile in the next pull request" },
  "game-overlays.ts": { calls: ["keepCopy(path.join(backupsDir(userData), BEFORE_SETUPS_DIR))", "writeFileAtomic(this.file)"], what: "the backup before the move to setups; game-overlays.json moves to SavedFile in the next pull request" },
  "storage.ts": { calls: ["writeFileAtomic(this.file)", "writeFileAtomic(file)", "writeFileAtomic(file)"], what: "module settings and panel state; move to SavedFile in the next pull request" },
  "documents.ts": { calls: ["writeFileAtomic(this.file(docId))", "writeFileAtomic(this.indexFile)"], what: "the documents' index.json, rebuilt from them; the documents move to SavedFile in the next pull request" },
  "folder-access.ts": { calls: ["writeFileAtomic(this.file)"], what: "folders.json; moves to SavedFile in the next pull request" },
  "workspace-move.ts": { calls: ["keepCopy(backup)", "writeFileAtomic(path.join(userData, name))"], what: "the move to the workspace names at start, after keepNewerFiles, of files that still have the old names, and their backup" },
  "moved-modules.ts": { calls: ["writeFileAtomic(file)"], what: "the moves of renamed modules at start, after keepNewerFiles" },
  "module-data.ts": { calls: ["writeFileAtomic(file)"], what: "the sweep's hold list: bookkeeping, not in saved-versions.ts" },
  "read-only-files.ts": { calls: ["writeFileAtomic(this.file)", "writeFileAtomic(path.join(path.dirname(this.file), 'picker.json'))"], what: "sources.json, the version on each entry (NOT_SAVED_FILES), and picker.json (a hint)" },
  "host.ts": { calls: ['appendFile(path.join(this.options.userData, "updates.log"))', "writeFileAtomic(file)"], what: "updates.log, and ai-usage.json (NOT_SAVED_FILES)" },
  "account.ts": { calls: ["writeFileAtomic(file)"], what: "account.json, sealed (NOT_SAVED_FILES)" },
  "account-key.ts": { calls: ["writeFileAtomic(seenFile)", "writeFileAtomic(file)", "writeFileAtomic(place.keyFile)"], what: "the account vault's seen mark and cache, and the sealed key file (NOT_SAVED_FILES)" },
  "discord-store.ts": { calls: ["writeFileAtomic(file)"], what: "discord.json, sealed (NOT_SAVED_FILES)" },
  "cloud-copy.ts": { calls: ["writeFile(path.join(partsDir, id))", "writeFile(content)", "cp(from)", "writeFileAtomic(file)"], what: "the cloud copy's files, being changed elsewhere (#909)" },
  "cloud-copy-sync.ts": {
    calls: ["writeFileAtomic(this.listFile)", "writeFileAtomic(path.join(dir, KEEP_WHOLE))", "writeFileAtomic(this.listFile)", "writeFileAtomic(file)", "writeFileAtomic(file)"],
    what: "the cloud copy's files, being changed elsewhere (#909)",
  },
  "cloud-copy-swap.ts": { calls: ["writeFileAtomic(file)"], what: "the cloud copy's files, being changed elsewhere (#909)" },
  "copy-folder.ts": { calls: ["writeFileAtomic(file)", "writeFile(probe)"], what: "the cloud copy's folder, being changed elsewhere (#909)" },
  "pairing.ts": { calls: ["writeFileAtomic(file)", "writeFileAtomic(this.file(id, step))"], what: "pairing's steps and pairing-answers.json, one pairing at a time" },
  "backup.ts": { calls: ["copyFile(path.join(userData, name))", "cp(from)"], what: "the daily backup's copies of the data files" },
  "diagnostics.ts": { calls: ["writeFileSync(file)"], what: "the crash and diagnostics log" },
  "example-copy.ts": { calls: ["writeFile(to)", "copyFile(path.join(source, file))", 'writeFile(path.join(target, ".gitignore"))'], what: "an example module copied into the developer's own folder" },
  "file-dialogs.ts": { calls: ["writeFile(file)"], what: "a file the user saves from a module, where they chose in the save dialog" },
  "installer.ts": {
    calls: ["writeFile(file.data)", "writeFile(`${old}${UPDATING}`)", "writeFile(`${old}${DONE}`)", "writeFile(path.join(stagingRoot, `${REMOVED}${moduleId}`))"],
    what: "a module's files from its zip, and the install's own markers",
  },
  "module-files.ts": { calls: ["writeFile(probe)", "copyFile(fileAt(from, file))"], what: "a probe of the module files folder, and a module's files moved to a new one" },
  "official-publish.ts": { calls: ['appendFile(path.join(this.options.userData, "official-publishes.log"))', "writeFile(file)"], what: "the official publishes' log, and a manifest in the developer's own folder" },
  "appearance.ts": { calls: ["writeFileAtomic(path.join(folder, name))"], what: "a starter theme or style the user makes, in its own folder" },
  "module-publish.ts": { calls: ["writeFileAtomic(file)", "writeFileAtomic(manifestFile)", "writeFileAtomic(pkgFile)", "writeFileAtomic(file)"], what: "a module developer's manifest, changelog and package.json, in their own folder" },
  "games-seen.ts": { calls: ["writeFileAtomic(this.file)"], what: "games-seen.json: when games were seen running" },
  "inbox.ts": { calls: ["writeFileAtomic(this.o.file)"], what: "inbox.json: which notes were shown" },
  "panel-cover.ts": { calls: ["writeFileAtomic(this.file)"], what: "open-times.json: how fast layouts open here" },
  "publisher-names.ts": { calls: ["writeFileAtomic(this.options.file)"], what: "publisher-names.json: downloaded" },
  "safety-lists.ts": { calls: ["writeFileAtomic(this.options.file)"], what: "catalog-lists.json: downloaded" },
  "module-folder-check.ts": { calls: ["writeFileAtomic(this.file)"], what: "module-checks.json: the folders' signature checks, made again when missing" },
  "official-key-store.ts": { calls: ["writeFileAtomic(this.file)"], what: "official-publisher-key.bin: development builds only" },
  "icons.ts": { calls: ["writeFileAtomic(path.join(iconDir, file))"], what: "icons, not JSON" },
  "hosted-icons.ts": { calls: ["writeFileAtomic(path.join(iconDir, file))"], what: "icons, not JSON" },
  "steam-icons.ts": { calls: Array.from({ length: 5 }, () => "writeFileAtomic(path.join(iconDir, file))"), what: "icons, not JSON" },
  "steam-shortcuts.ts": { calls: ["writeFileAtomic(path.join(iconDir, file))"], what: "icons, not JSON" },
  "layout-pictures.ts": { calls: ["writeFileAtomic(this.file(gameId))"], what: "pictures, not JSON" },
  "profile.ts": { calls: ["writeFileAtomic(path.join(dir, file))"], what: "the profile picture, not JSON" },
};

/** The source files of main/, without comments. */
async function sources(): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for (const name of (await readdir(__dirname)).sort()) {
    if (!name.endsWith(".ts") || name.endsWith(".test.ts") || name.includes("test-helper")) continue;
    const text = await readFile(path.join(__dirname, name), "utf8");
    found.set(name, text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1"));
  }
  return found;
}

/** The arguments of the call whose `(` is just before `from`, each as its text with spaces made single. */
function argumentsAt(text: string, from: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = from; i < text.length; i++) {
    const char = text[i]!;
    if ("([{".includes(char)) depth++;
    if (")]}".includes(char)) {
      if (depth === 0) break;
      depth--;
    }
    if (char === "," && depth === 0) {
      args.push(current);
      current = "";
    } else current += char;
  }
  args.push(current);
  return args.map((arg) => arg.replace(/\s+/g, " ").trim());
}

/** The names a source file imports, re-exports included. */
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

  it("every SavedFile is made with a kind from SAVED_FILES", async () => {
    const made: string[] = [];
    for (const [name, text] of await sources()) {
      for (const match of text.matchAll(/new\s+SavedFile\s*\(/g)) {
        const kind = argumentsAt(text, match.index + match[0].length)[1] ?? "";
        made.push(kind);
        expect(kind, `${name}: new SavedFile(…, ${kind})`).toMatch(/^SAVED_FILES(\.[\w$]+|\[[^\]]+\])$/);
      }
    }
    expect(made.length).toBeGreaterThan(0);
  });

  it("only SavedFile uses the pieces of the rules, and those this file names", async () => {
    const users = [...(await sources())].filter(([, text]) => RULE_PIECES.some((piece) => importedNames(text).has(piece))).map(([file]) => file);
    expect(users.filter((file) => !(file in USES_RULE_PIECES))).toEqual([]);
    // A file that stopped using them leaves the list, so it only ever gets shorter.
    expect(Object.keys(USES_RULE_PIECES).filter((file) => !users.includes(file))).toEqual([]);
  });

  it("no source reaches the file system, the rules or fsutil.ts through a namespace, a default import or require", async () => {
    const modules = String.raw`(?:node:)?fs(?:\/promises)?|\.\/(?:fsutil|json|saved-versions|saved-file|rename-held)`;
    const ways = [
      new RegExp(String.raw`import\s+\*\s+as\s+[\w$]+\s+from\s*["'](?:${modules})["']`),
      new RegExp(String.raw`import\s+[\w$]+\s*(?:,\s*\{[^}]*\})?\s+from\s*["'](?:${modules})["']`),
      new RegExp(String.raw`(?:require|import)\s*\(\s*["'](?:${modules})["']`),
    ];
    const found = [...(await sources())].filter(([, text]) => ways.some((way) => way.test(text))).map(([file]) => file);
    expect(found).toEqual([]);
  });

  it("every other write of a file is one this file names, with what it writes", async () => {
    const found: Record<string, string[]> = {};
    for (const [name, text] of await sources()) {
      for (const match of text.matchAll(WRITE_CALLS)) {
        // The definitions in fsutil.ts are not calls.
        if (/function\s*$/.test(text.slice(Math.max(0, match.index - 20), match.index))) continue;
        (found[name] ??= []).push(`${match[1]}(${argumentsAt(text, match.index + match[0].length)[0]})`);
      }
    }
    const listed = Object.fromEntries(Object.entries(WRITES).map(([name, { calls }]) => [name, [...calls].sort()]));
    // Every write there is listed, as often as it is there; a write that went leaves the list, so it only gets shorter.
    expect(Object.fromEntries(Object.entries(found).map(([name, calls]) => [name, calls.sort()]))).toEqual(listed);
  });
});
