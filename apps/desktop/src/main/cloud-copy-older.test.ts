// An older Tavora's cloud copy code, from git, against what this one writes into a folder: the previous version has to keep
// reading it (CLAUDE.md, saved data). It checks against the last release (the newest v* tag, as `pnpm release` reads
// them), since main holds this very code. To check another ref, set TAVORA_COMPAT_REF, for example
// `TAVORA_COMPAT_REF=v0.24.133` or `TAVORA_COMPAT_REF=origin/some-branch`; a ref git can't find fails the test.
// Without any release tag in the checkout (a shallow clone: fetch with `git fetch --tags`) the test is skipped.
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CloudCopy, EMPTY_STATE, openManifest, saveCopyState, type CopyState } from "./cloud-copy";
import { cleanUp, pc } from "./cloud-copy.test-helper";
import { copyKeys, newCopyKey } from "./copy-crypto";
import { FolderStorage } from "./copy-folder";

const DAY = 24 * 60 * 60_000;
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** The ref to check against: TAVORA_COMPAT_REF, else the last release's tag; undefined when the checkout has no release tag. */
function compatRef(): string | undefined {
  const given = process.env.TAVORA_COMPAT_REF?.trim();
  if (given) {
    try {
      execFileSync("git", ["rev-parse", "--verify", "--quiet", `${given}^{commit}`], { cwd: desktop, stdio: "ignore" });
    } catch {
      throw new Error(`TAVORA_COMPAT_REF=${given}: git can't find that ref. Use a tag or branch that exists here (git fetch --tags origin first, if it is a release).`);
    }
    return given;
  }
  // Release tags are v<major>.<minor>.<patch>, which is how `pnpm release` tags (scripts/release.mjs); git sorts them as versions.
  const tags = execFileSync("git", ["tag", "--list", "v[0-9]*.[0-9]*.[0-9]*", "--sort=-v:refname"], { cwd: desktop, encoding: "utf8" });
  return tags.split(/\r?\n/).find((tag) => /^v\d+\.\d+\.\d+$/.test(tag));
}
const ref = compatRef();

type Older = {
  CloudCopy: new (storage: unknown) => {
    upload(key: Uint8Array, roots: unknown, state: unknown): Promise<{ status: string; state?: { version: number } }>;
    download(key: Uint8Array, roots: unknown, staging: string, synced?: number, seen?: object): Promise<{ version: number; marked?: boolean } | null>;
  };
  FolderStorage: new (folder: string, options?: { now?: () => number }) => { remote(known?: number): Promise<{ version: number; follows?: boolean } | null> };
  loadCopyState(file: string): Promise<{ version: number; marked?: boolean; files: object }>;
};

describe.skipIf(!ref)(`the cloud copy code of ${ref ?? "an older Tavora"}`, () => {
  let older: Older;
  let tree: string;
  // A release from before lists were marked (#909) neither says nor keeps `marked`; what this Tavora saves must still open there.
  let marks = true;
  const folders: string[] = [];

  beforeAll(async () => {
    // Inside apps/desktop, so its imports find the same packages; never under src, so its tests aren't run.
    tree = await mkdtemp(path.join(desktop, ".older-"));
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: desktop, encoding: "utf8" }).trim();
    const archive = execFileSync("git", ["archive", `${ref!}:apps/desktop/src`], { cwd: top, maxBuffer: 1024 * 1024 * 1024 });
    await mkdir(path.join(tree, "src"));
    // In the folder itself, not with -C: Git Bash's GNU tar reads "C:" in a path as a remote host.
    execFileSync("tar", ["-x"], { cwd: path.join(tree, "src"), input: archive });
    const load = (file: string) => import(/* @vite-ignore */ pathToFileURL(path.join(tree, "src", "main", file)).href);
    older = { ...(await load("cloud-copy.ts")), ...(await load("copy-folder.ts")) } as Older;
    marks = /\bmarked\b/.test(await readFile(path.join(tree, "src", "main", "cloud-copy.ts"), "utf8"));
  }, 60_000);

  afterAll(async () => {
    await cleanUp();
    for (const dir of folders) await rm(dir, { recursive: true, force: true });
    if (tree) await rm(tree, { recursive: true, force: true });
  });

  async function folder(): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tavora-older-"));
    folders.push(dir);
    return dir;
  }

  async function save(storage: FolderStorage, key: Uint8Array, at: Awaited<ReturnType<typeof pc>>, state: CopyState, text: string): Promise<CopyState> {
    await mkdir(at.userData, { recursive: true });
    await writeFile(path.join(at.userData, "library.json"), text);
    const result = await new CloudCopy(storage).upload(key, at.roots, state);
    if (result.status !== "uploaded") throw new Error(result.status);
    return result.state;
  }

  const manifestNames = async (dir: string) => (await readdir(path.join(dir, "Tavora", "manifests"))).sort();
  /** The newest list in the folder, opened by this Tavora. */
  async function newestList(dir: string, key: Uint8Array) {
    const body = await readFile(path.join(dir, "Tavora", "manifests", (await manifestNames(dir)).at(-1)!));
    return openManifest(copyKeys(key), body.subarray(16 + body.readUInt32BE(12) * 32));
  }

  it("reads, follows, saves over and cleans up the lists this Tavora writes, line and all", { timeout: 60_000 }, async () => {
    const key = newCopyKey();
    const dir = await folder();
    const clock = { now: Date.now() };
    const a = await pc();
    let state = await save(new FolderStorage(dir), key, a, EMPTY_STATE, "k");
    const k = state;
    for (let round = 1; round <= 6; round++) state = await save(new FolderStorage(dir), key, a, state, `a${round}`);
    const newest = state;
    const { manifest, listed } = await newestList(dir, key);
    expect(listed).toBe(true);
    expect(manifest.line).toHaveLength(6);

    // The older code takes the newest copy, marked, and says it follows the versions in its line.
    const b = await pc();
    const staging = path.join(b.root, "staging");
    const down = await new older.CloudCopy(new older.FolderStorage(dir)).download(key, b.roots, staging, k.version, { sealed: true, marked: true });
    expect(down).toMatchObject(marks ? { version: newest.version, marked: true } : { version: newest.version });
    expect(await readFile(path.join(staging, "library.json"), "utf8")).toBe("a6");
    expect(await new older.FolderStorage(dir).remote(k.version)).toMatchObject({ version: newest.version, follows: true });

    // A month later it saves on top, and its clean-up checks the lists this Tavora wrote: it drops all but the newest five
    // marked ones. (One it couldn't check would stop it, and nothing would go.)
    clock.now += 40 * DAY;
    for (const name of await readdir(path.join(dir, "Tavora"), { recursive: true })) {
      const then = new Date(clock.now - 35 * DAY);
      await utimes(path.join(dir, "Tavora", name), then, then);
    }
    await mkdir(b.userData, { recursive: true });
    await writeFile(path.join(b.userData, "library.json"), "b");
    const fromOlder = await new older.CloudCopy(new older.FolderStorage(dir, { now: () => clock.now })).upload(key, b.roots, { version: newest.version, pictures: true, files: {} });
    expect(fromOlder.status).toBe("uploaded");
    expect(await manifestNames(dir)).toHaveLength(5);
    // A save from before marks has none, and this Tavora turns such a copy away on purpose (reason "older"): nothing to follow.
    if (!marks) return;

    // This Tavora follows the older one's save, sealed right on top of its own, and goes on with the line through it.
    const at = await pc();
    await expect(new CloudCopy(new FolderStorage(dir)).download(key, at.roots, path.join(at.root, "staging"), newest.version, newest)).resolves.toMatchObject({ version: fromOlder.state!.version, marked: true });
    const after = await save(new FolderStorage(dir), key, a, { ...newest, version: fromOlder.state!.version, kept: true }, "a7");
    const last = await newestList(dir, key);
    expect(last.manifest.version).toBe(after.version);
    expect(last.manifest.line!.slice(0, 2)).toEqual([fromOlder.state!.version, newest.version]);
  });

  it("reads the state this Tavora saves", async () => {
    const dir = await folder();
    const file = path.join(dir, "cloud-copy.json");
    await saveCopyState(file, { ...EMPTY_STATE, version: 5, sealed: true, marked: true, listed: true, keyId: "abc" });
    expect(await older.loadCopyState(file)).toMatchObject(marks ? { version: 5, marked: true } : { version: 5 });
  });
});
