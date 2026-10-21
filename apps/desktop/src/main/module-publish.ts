import type { KeyObject } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { manifestFiles, validateChangelog, validateManifest, type ChangelogEntry, type ModuleManifest } from "@tavora/module-schema";
import { MANIFEST_FILE, packModule, PackError, type Published } from "@tavora/pack";
import type { AccountView, PrefixState, PublishProblem, PublishView } from "../shared/host-api";
import { suggestPrefix } from "../shared/id-prefix";
import { writeFileAtomic } from "./fsutil";
import { compareModuleVersions } from "./installer";
import { PlayerError } from "./messages";

// The Publish button (decided 2026-10-21, "Easier module publishing"): a dev module from a project folder
// goes to the catalog from Tavora, with no terminal. Tavora packs the folder as it is (it builds nothing:
// dist/ is what `npm run dev` left there), signed with a publisher key it keeps, and shows a review screen:
// what the module is and asks for, how old the build is, what the catalog lists, and what stops it from
// going out, each with its fix. That screen's Publish uploads exactly the zip it showed, with the account's
// sign-in; the click is the approval. The fixes write into the project's own files: the version and its
// patch notes, or a new id before the first publish.

/** Most files looked at for the build's and the sources' age; a project is far smaller. */
const MAX_FILES_LOOKED_AT = 5000;
const SEMVER_CORE = /^(\d+)\.(\d+)\.(\d+)/;

export interface ModulePublisherOptions {
  /** The kept, linked key to sign with (`prefer`, the key the catalog lists the module under, if kept); null before setup. */
  key: (prefer?: string) => { key: KeyObject; fingerprint: string } | null;
  account: {
    prefixes: () => AccountView["prefixes"];
    developerName: () => string | null;
    checkPrefix: (prefix: string) => Promise<PrefixState>;
    upload: (key: KeyObject, zip: Buffer) => Promise<Published>;
  };
  /** What the catalog lists under an id: its newest version and key, or null for nothing. Throws when it can't be asked. */
  listed: (id: string) => Promise<{ version: string; owner: string } | null>;
  /** Every check the installer makes of a zip, with nothing written. Throws a PlayerError. */
  check: (zip: Buffer) => Promise<void>;
  /** The loaded module's icon, as Settings shows it. */
  icon: (id: string) => string | null;
  /** A player error in the player's language. */
  translate: (error: PlayerError) => string;
  onChange: (view: PublishView | null) => void;
  now?: () => number;
}

interface Review {
  view: PublishView;
  /** The zip the screen shows, signed with `key`; null while something stops it. */
  zip: Buffer | null;
  key: KeyObject | null;
}

export class ModulePublisher {
  private review: Review | null = null;
  /** Bumped by every new look at the project, so an older one that finishes late changes nothing. */
  private round = 0;

  constructor(private readonly options: ModulePublisherOptions) {}

  view(): PublishView | null {
    return this.review?.view ?? null;
  }

  /** Opens the review screen for a project folder and packs it. */
  async open(project: string): Promise<void> {
    if (!this.options.key()) throw new PlayerError("publish.error.setup");
    this.review = { view: emptyView(project), zip: null, key: null };
    await this.refresh();
  }

  /** Packs the reviewed project again and asks the catalog again. */
  async refresh(): Promise<void> {
    const review = this.review;
    if (!review || review.view.status === "publishing") return;
    const round = ++this.round;
    review.view = { ...review.view, status: "checking", error: null };
    this.changed();
    let next: Review;
    try {
      next = await this.look(review.view.project);
    } catch (error) {
      if (!(error instanceof PlayerError)) console.error("[tavora] reviewing a module failed", error);
      next = { ...review, view: { ...review.view, status: "ready", error: this.options.translate(error instanceof PlayerError ? error : new PlayerError("error.generic")) }, zip: null };
    }
    if (round !== this.round || this.review !== review) return;
    this.review = next;
    this.changed();
  }

  /** Writes a version and its patch notes into the reviewed project's files, then packs again. */
  async writeVersion(version: string, notes: string[]): Promise<void> {
    const review = this.current();
    await writeVersion(review.view.project, version, notes, localDate(this.options.now?.() ?? Date.now()));
    await this.refresh();
  }

  /** Gives the reviewed module a new id, while nothing is published under the old one. */
  async setId(id: string): Promise<void> {
    const review = this.current();
    if (!review.view.problems.some((problem) => problem.kind === "prefix") && review.view.catalog.kind !== "first") throw new PlayerError("publish.error.idPublished");
    await writeId(review.view.project, id);
    await this.refresh();
  }

  /** Uploads the zip the screen shows. */
  async publish(): Promise<void> {
    const review = this.current();
    const { zip, key } = review;
    if (review.view.status !== "ready" || !zip || !key || review.view.problems.length > 0) throw new PlayerError("publish.error.notReady");
    review.view = { ...review.view, status: "publishing", error: null };
    this.changed();
    try {
      const published = await this.options.account.upload(key, zip);
      review.view = { ...review.view, status: "published", published: { id: published.id, version: published.version } };
    } catch (error) {
      review.view = { ...review.view, status: "ready", error: this.options.translate(error instanceof PlayerError ? error : new PlayerError("error.generic")) };
      if (!(error instanceof PlayerError)) console.error("[tavora] publishing failed", error);
    }
    if (this.review === review) this.changed();
  }

  close(): void {
    this.round++;
    this.review = null;
    this.changed();
  }

  /** Packs a project folder signed with a kept key, for Save as zip. */
  async pack(project: string): Promise<{ manifest: ModuleManifest; zip: Buffer }> {
    const signer = this.options.key();
    if (!signer) throw new PlayerError("publish.error.setup");
    try {
      return await packModule(project, signer.key);
    } catch (error) {
      if (error instanceof PackError) throw new PlayerError("publish.error.pack", { message: error.message });
      throw error;
    }
  }

  private current(): Review {
    if (!this.review) throw new PlayerError("publish.error.notReady");
    return this.review;
  }

  /** Everything the screen shows about the project as it is now. */
  private async look(project: string): Promise<Review> {
    const view = emptyView(project);
    view.ownPrefix = this.ownPrefix();
    const manifest = await readManifest(project);
    if ("problem" in manifest) {
      view.problems.push(manifest.problem);
      return { view: { ...view, status: "ready" }, zip: null, key: null };
    }
    const { id, name, version } = manifest;
    view.module = { id, name, version, icon: this.options.icon(id) };
    view.asks = { network: [...manifest.permissions.network], connectors: [...(manifest.permissions.connectors ?? [])] };
    view.notes = (await readChangelog(project, manifest)).find((entry) => entry.version === version)?.notes ?? [];

    const [built, listed, prefixState] = await Promise.all([
      buildAge(project, manifest),
      this.options.listed(id).then(
        (entry) => entry,
        () => undefined,
      ),
      this.options.account.checkPrefix(id.split(".")[0]!).catch(() => null),
    ]);
    view.builtAt = built.builtAt;
    view.sourceNewer = built.sourceNewer;
    view.catalog = listed === undefined ? { kind: "unknown" } : listed === null ? { kind: "first" } : { kind: "update", version: listed.version };
    if (listed && compareModuleVersions(version, listed.version) <= 0) view.problems.push({ kind: "version", listed: listed.version, next: nextVersions(listed.version) });
    const prefix = id.split(".")[0]!;
    if (prefixState && prefixState !== "held" && prefixState !== "free") view.problems.push({ kind: "prefix", prefix, state: prefixState });
    if (prefixState === "free") view.newPrefix = { prefix, max: this.options.account.prefixes()?.max ?? 3 };
    if (!built.complete) {
      view.problems.push({ kind: "not-built" });
      return { view: { ...view, status: "ready" }, zip: null, key: null };
    }

    const signer = this.options.key(listed?.owner);
    if (!signer) throw new PlayerError("publish.error.setup");
    let zip: Buffer;
    try {
      zip = (await packModule(project, signer.key)).zip;
      await this.options.check(zip);
    } catch (error) {
      if (!(error instanceof PackError) && !(error instanceof PlayerError)) throw error;
      const message = error instanceof PlayerError ? this.options.translate(error) : this.options.translate(new PlayerError("publish.error.pack", { message: error.message }));
      view.problems.push({ kind: "invalid", message });
      return { view: { ...view, status: "ready" }, zip: null, key: null };
    }
    view.size = zip.length;
    return { view: { ...view, status: "ready" }, zip, key: signer.key };
  }

  /** A prefix the account holds, else one made from the developer name; null without either. */
  ownPrefix(): string | null {
    const held = [...(this.options.account.prefixes()?.held ?? [])].sort((a, b) => a.claimedAt - b.claimedAt);
    return held[0]?.prefix ?? suggestPrefix(this.options.account.developerName() ?? "");
  }

  private changed(): void {
    this.options.onChange(this.view());
  }
}

function emptyView(project: string): PublishView {
  return {
    project,
    status: "checking",
    module: null,
    notes: [],
    asks: { network: [], connectors: [] },
    size: null,
    builtAt: null,
    sourceNewer: false,
    catalog: { kind: "unknown" },
    problems: [],
    newPrefix: null,
    ownPrefix: null,
    error: null,
    published: null,
  };
}

/** The next patch, minor and major version after a listed one. */
export function nextVersions(listed: string): { patch: string; minor: string; major: string } {
  const [, major = "0", minor = "0", patch = "0"] = SEMVER_CORE.exec(listed) ?? [];
  const [x, y, z] = [Number(major), Number(minor), Number(patch)];
  // A pre-release (1.2.0-beta) comes before 1.2.0 itself, so that one is the next patch.
  const pre = listed.includes("-");
  return { patch: `${x}.${y}.${pre ? z : z + 1}`, minor: `${x}.${y + 1}.0`, major: `${x + 1}.0.0` };
}

/** The project's manifest, or what is wrong with it. */
async function readManifest(project: string): Promise<ModuleManifest | { problem: PublishProblem }> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path.join(project, MANIFEST_FILE), "utf8"));
  } catch {
    return { problem: { kind: "invalid", message: `${MANIFEST_FILE} is missing or not valid JSON` } };
  }
  const result = validateManifest(raw);
  return result.ok ? result.manifest : { problem: { kind: "invalid", message: result.errors.slice(0, 3).join("; ") } };
}

async function readChangelog(project: string, manifest: ModuleManifest): Promise<ChangelogEntry[]> {
  if (manifest.changelog === undefined) return [];
  try {
    const result = validateChangelog(JSON.parse(await readFile(path.join(project, manifest.changelog), "utf8")));
    return result.ok ? result.entries : [];
  } catch {
    return [];
  }
}

/**
 * How old the build is: the newest file in the folders the entry pages are in (dist/), and whether a file
 * in src/ changed after it. `complete` is false when an entry page isn't there: nothing was built yet.
 */
export async function buildAge(project: string, manifest: ModuleManifest): Promise<{ complete: boolean; builtAt: number | null; sourceNewer: boolean }> {
  const { entries } = manifestFiles(manifest);
  const present = await Promise.all(entries.map((entry) => lstat(path.join(project, entry)).then((info) => info.isFile(), () => false)));
  if (present.includes(false)) return { complete: false, builtAt: null, sourceNewer: false };
  const folders = [...new Set(entries.map((entry) => (entry.includes("/") ? entry.split("/")[0]! : null)))];
  // An entry page next to the manifest has no build folder: there is no build to be old.
  if (folders.includes(null)) return { complete: true, builtAt: null, sourceNewer: false };
  let builtAt = 0;
  for (const folder of folders) builtAt = Math.max(builtAt, await newest(path.join(project, folder!)));
  const source = await newest(path.join(project, "src"));
  return { complete: true, builtAt: builtAt || null, sourceNewer: builtAt > 0 && source > builtAt };
}

/** The newest file's time in a folder and the folders in it (0 for none); links are not followed. */
async function newest(dir: string): Promise<number> {
  let latest = 0;
  let looked = 0;
  const visit = async (folder: string): Promise<void> => {
    const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (++looked > MAX_FILES_LOOKED_AT) return;
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile()) latest = Math.max(latest, (await lstat(full).catch(() => null))?.mtimeMs ?? 0);
    }
  };
  await visit(dir);
  return Math.round(latest);
}

// ── Writing into the project ───────────────────────────────────────────

/** The text of a JSON file as it was, so it is written back with its own indent and last line break. */
async function readJson(file: string): Promise<{ value: Record<string, unknown>; indent: string; newline: boolean } | null> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new PlayerError("publish.error.badFile", { file: path.basename(file) });
  }
  return { value: value as Record<string, unknown>, indent: /^([ \t]+)"/m.exec(text)?.[1] ?? "  ", newline: text.endsWith("\n") };
}

const jsonText = (value: unknown, indent = "  ", newline = true) => JSON.stringify(value, null, indent) + (newline ? "\n" : "");

/**
 * Raises the module's version and writes its patch notes: the version into tavora.module.json (and
 * package.json, when that had the same one), the notes as the newest entry of the changelog the manifest
 * names, which is made (changelog.json) when there is none. The changelog goes first, so the manifest
 * never names a version or a file that isn't there.
 */
export async function writeVersion(project: string, version: string, notes: string[], date: string): Promise<void> {
  const manifestFile = path.join(project, MANIFEST_FILE);
  const manifest = await readJson(manifestFile);
  if (!manifest) throw new PlayerError("publish.error.badFile", { file: MANIFEST_FILE });
  const current = validateManifest(manifest.value);
  if (!current.ok) throw new PlayerError("publish.error.badFile", { file: MANIFEST_FILE });
  const next: Record<string, unknown> = { ...manifest.value, version };
  const lines = notes.map((note) => note.trim()).filter(Boolean);
  if (lines.length > 0) {
    const name = current.manifest.changelog ?? "changelog.json";
    next.changelog = name;
    const file = path.join(project, name);
    const existing = await readFile(file, "utf8").then(
      (text) => text,
      () => null,
    );
    let entries: unknown[] = [];
    if (existing !== null) {
      const parsed = (() => {
        try {
          return validateChangelog(JSON.parse(existing));
        } catch {
          return { ok: false as const };
        }
      })();
      if (!parsed.ok) throw new PlayerError("publish.error.badFile", { file: name });
      entries = parsed.entries.filter((entry) => entry.version !== version);
    }
    const changelog = [{ version, date, notes: lines }, ...entries];
    const checked = validateChangelog(changelog);
    if (!checked.ok) throw new PlayerError("publish.error.notes", { message: checked.errors[0] ?? "" });
    await writeFileAtomic(file, jsonText(changelog, /^([ \t]+)/m.exec(existing ?? "")?.[1] ?? "  "));
  }
  if (!validateManifest(next).ok) throw new PlayerError("publish.error.version");
  await writeFileAtomic(manifestFile, jsonText(next, manifest.indent, manifest.newline));
  // The starter keeps package.json at the module's version; it follows when it still does.
  const pkgFile = path.join(project, "package.json");
  const pkg = await readJson(pkgFile).catch(() => null);
  if (pkg && pkg.value.version === current.manifest.version) await writeFileAtomic(pkgFile, jsonText({ ...pkg.value, version }, pkg.indent, pkg.newline));
}

/** Gives the module a new id in tavora.module.json. */
export async function writeId(project: string, id: string): Promise<void> {
  const file = path.join(project, MANIFEST_FILE);
  const manifest = await readJson(file);
  if (!manifest) throw new PlayerError("publish.error.badFile", { file: MANIFEST_FILE });
  const next = { ...manifest.value, id };
  if (!validateManifest(next).ok) throw new PlayerError("publish.error.badId");
  await writeFileAtomic(file, jsonText(next, manifest.indent, manifest.newline));
}

/** YYYY-MM-DD on this PC's calendar. */
function localDate(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
