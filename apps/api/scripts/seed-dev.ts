// Fills a state folder with fake data, so Tavora Admin can run locally against a real API that looks lived in:
//
//   node --conditions=source apps/api/scripts/seed-dev.ts --state <dir> --games <file> [--fresh]
//
// It writes everything `src/server.ts` opens under TAVORA_STATE_DIR (accounts, catalog with signed zips, reviews, conversations,
// stats, activity, icon offers, cloud copies) and a small games dataset for TAVORA_GAMES_DB, through the stores' own methods.
// The data is invented and for development only; never run it against a real state folder. A folder that already holds data is
// refused unless --fresh is given, which deletes that folder and seeds again.
import { createPrivateKey, createPublicKey, createHash, type KeyObject } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { signFiles, writeZip, type ZipFile } from "@tavora/pack";
import { AccountStore, type Account, type DeviceOs } from "../src/account-store.ts";
import { ActivityLog } from "../src/activity-log.ts";
import { CatalogStore, type ReviewReason } from "../src/catalog.ts";
import { CopyStore } from "../src/cloud-copy.ts";
import { builtInTexts, ConversationStore, type Conversation } from "../src/conversations.ts";
import { buildDataset, writeDatabase } from "../src/dataset.ts";
import { IconState } from "../src/icon-state.ts";
import { keyFingerprint } from "../src/publishers.ts";
import { encodePng } from "../src/png.ts";
import { checkReviewText } from "../src/review-filter.ts";
import { ReviewStore } from "../src/reviews.ts";
import { StatsStore, STAT_KINDS, utcDay } from "../src/stats.ts";

const DAY = 24 * 3_600_000;
const HOUR = 3_600_000;

export interface SeedSummary {
  games: number;
  accounts: number;
  developers: number;
  suspended: number;
  banned: number;
  modules: number;
  versions: number;
  waitingVersions: number;
  unlistedModules: number;
  openModuleReports: number;
  blocksToSign: number;
  reviews: number;
  reviewsHeld: number;
  reviewsCapped: number;
  reviewsHidden: number;
  reviewsInQueue: number;
  reviewsReported: number;
  conversations: number;
  tavoraConversations: number;
  reportedConversations: number;
  iconOffers: number;
  iconsApproved: number;
  keyRequests: number;
  cloudCopies: number;
  statDays: number;
  statRows: number;
  activityEntries: number;
}

// ── Small helpers ────────────────────────────────────────────────────────

/** A seeded pseudo-random generator (mulberry32): the same seed always gives the same data. */
function makeRandom(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  return {
    next,
    int,
    chance: (p: number) => next() < p,
    pick: <T>(items: readonly T[]): T => items[int(0, items.length - 1)]!,
    /** Roughly normal, mean 0, spread 1. */
    gauss: () => next() + next() + next() + next() - 2,
    bytes: (length: number) => Buffer.from(Uint8Array.from({ length }, () => int(0, 255))),
  };
}
type Random = ReturnType<typeof makeRandom>;

/** An ed25519 key made from a seed, so a publisher keeps the same key (and fingerprint) in every run. */
function keyFromSeed(seed: Buffer): KeyObject {
  return createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]), format: "der", type: "pkcs8" });
}
const rawPublic = (key: KeyObject) => createPublicKey(key).export({ format: "der", type: "spki" }).subarray(12);

/** A picture of flat colour with a soft diagonal, as a PNG. */
function picture(size: number, hue: number): Uint8Array {
  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const shade = 0.65 + 0.35 * ((x + y) / (2 * size));
      const at = (y * size + x) * 4;
      rgba[at] = Math.round(((hue * 53) % 200) * shade) + 40;
      rgba[at + 1] = Math.round(((hue * 97) % 200) * shade) + 40;
      rgba[at + 2] = Math.round(((hue * 31) % 200) * shade) + 40;
      rgba[at + 3] = 255;
    }
  }
  return encodePng(size, size, rgba);
}

// ── The games ────────────────────────────────────────────────────────────

const GAMES: { name: string; aliases?: string[] }[] = [
  { name: "Elden Ring" },
  { name: "Baldur's Gate 3", aliases: ["BG3"] },
  { name: "Path of Exile 2", aliases: ["PoE2"] },
  { name: "Enshrouded" },
  { name: "Satisfactory" },
  { name: "World of Warcraft", aliases: ["WoW"] },
  { name: "Final Fantasy XIV", aliases: ["FFXIV"] },
  { name: "Diablo IV", aliases: ["Diablo 4"] },
  { name: "Minecraft" },
  { name: "Cyberpunk 2077" },
  { name: "The Witcher 3: Wild Hunt", aliases: ["Witcher 3"] },
  { name: "Hades" },
  { name: "Stardew Valley" },
  { name: "Terraria" },
  { name: "Factorio" },
  { name: "Counter-Strike 2", aliases: ["CS2"] },
  { name: "Dota 2" },
  { name: "Helldivers 2" },
  { name: "Palworld" },
  { name: "Lethal Company" },
  { name: "Valheim" },
  { name: "No Man's Sky" },
  { name: "Starfield" },
  { name: "Hollow Knight" },
  { name: "Dark Souls III" },
  { name: "Red Dead Redemption 2" },
  { name: "Rust" },
  { name: "Apex Legends" },
  { name: "Grim Dawn" },
  { name: "Last Epoch" },
];

// ── Accounts ─────────────────────────────────────────────────────────────

interface AccountSpec {
  key: string;
  email?: string;
  discord?: string;
  name: string | null;
  /** Days since the account was made. */
  age: number;
  /** Sign-ins: system, the PC's name, days since last used. */
  devices: { os: DeviceOs; name: string; used: number }[];
  picture?: boolean;
}

const ACCOUNTS: AccountSpec[] = [
  { key: "kai", email: "kai.brenner@example.com", name: "Kai Brenner", age: 300, picture: true, devices: [{ os: "windows", name: "Kai's Desktop", used: 0.1 }, { os: "linux", name: "Steam Deck", used: 6 }] },
  { key: "lena", email: "lena.hartmann@example.com", discord: "lena_h", name: "Lena Hartmann", age: 260, picture: true, devices: [{ os: "windows", name: "Gaming PC", used: 0.4 }] },
  { key: "wellbrained", email: "hello@wellbrained.example", name: "Wellbrained", age: 330, picture: true, devices: [{ os: "windows", name: "Studio PC", used: 0.05 }, { os: "macos", name: "MacBook", used: 2 }] },
  { key: "clickworks", email: "team@clickworks.example", name: "Clickworks", age: 40, devices: [{ os: "windows", name: "Office PC", used: 1 }] },
  { key: "quickbuck", email: "dev@quickbuck.example", name: "QuickBuck", age: 75, devices: [{ os: "windows", name: "PC", used: 40 }] },
  { key: "mara", email: "mara.vogel@example.com", name: "Mara", age: 200, picture: true, devices: [{ os: "windows", name: "Mara's PC", used: 0.2 }] },
  { key: "jonas", email: "jonas.keller@example.com", name: "Jonas", age: 180, devices: [{ os: "windows", name: "Jonas-PC", used: 3 }, { os: "linux", name: "Laptop", used: 12 }] },
  { key: "priya", email: "priya.nair@example.com", name: "Priya", age: 150, picture: true, devices: [{ os: "windows", name: "Priya's Rig", used: 1 }] },
  { key: "tom", email: "tom.avery@example.com", name: "Tom", age: 140, devices: [{ os: "windows", name: "DESKTOP-TOM", used: 9 }] },
  { key: "sofia", email: "sofia.rossi@example.com", name: "Sofia", age: 120, devices: [{ os: "macos", name: "Sofia's Mac", used: 0.7 }] },
  { key: "bytebard", discord: "ByteBard", name: "ByteBard", age: 110, devices: [{ os: "windows", name: "Main PC", used: 2 }] },
  { key: "nightowl", discord: "NightOwl", name: "NightOwl", age: 95, devices: [{ os: "windows", name: "Night PC", used: 20 }] },
  { key: "pixelpete", discord: "pixelpete", name: "Pete", age: 70, devices: [{ os: "linux", name: "Arch box", used: 5 }] },
  { key: "zed", discord: "zed_plays", name: "Zed", age: 33, devices: [{ os: "windows", name: "Zed-PC", used: 0.3 }] },
  { key: "ayla", discord: "ayla.k", name: "Ayla", age: 21, devices: [{ os: "windows", name: "Ayla's Laptop", used: 4 }] },
  { key: "ben", email: "ben.okafor@example.com", name: "Ben", age: 90, devices: [{ os: "windows", name: "Ben-Desktop", used: 15 }] },
  { key: "hannah", email: "hannah.lindqvist@example.com", name: "Hannah", age: 60, picture: true, devices: [{ os: "windows", name: "Hannah's PC", used: 1.5 }] },
  { key: "luca", email: "luca.moretti@example.com", name: "Luca", age: 45, devices: [{ os: "windows", name: "Luca-PC", used: 6 }, { os: "linux", name: "Work laptop", used: 7 }] },
  { key: "emma", email: "emma.walsh@example.com", name: "Emma", age: 30, devices: [{ os: "windows", name: "Emma's PC", used: 0.8 }] },
  { key: "omar", email: "omar.haddad@example.com", name: "Omar", age: 14, devices: [{ os: "windows", name: "Omar-Gaming", used: 2 }] },
  { key: "rob", email: "rob.spammer@example.com", name: "Rob", age: 50, devices: [{ os: "windows", name: "PC", used: 30 }] },
  { key: "noah", email: "noah.fischer@example.com", name: "Noah", age: 20 / 24, devices: [{ os: "windows", name: "Noah's PC", used: 0.02 }] },
  { key: "fresh", discord: "freshlyjoined", name: "Fresh", age: 9 / 24, devices: [{ os: "windows", name: "Home PC", used: 0.01 }] },
  { key: "chloe", email: "chloe.dubois@example.com", name: null, age: 3 / 24, devices: [{ os: "windows", name: "Chloe-PC", used: 0.005 }] },
  { key: "ines", email: "ines.pereira@example.com", discord: "ines_p", name: "Ines", age: 80, picture: true, devices: [{ os: "windows", name: "Ines-PC", used: 0.1 }] },
];

// ── Modules ──────────────────────────────────────────────────────────────

type Status = "listed" | "waiting" | "declined";

interface ModuleSpec {
  id: string;
  name: string;
  dev: string;
  description: string;
  games: string[];
  readme: string;
  versions: { version: string; age: number; notes: string[]; status?: Status; reasons?: ReviewReason[] }[];
  /** Mean of the stars users give it. */
  quality: number;
  /** How many ratings it gets in the story. */
  ratings: number;
  /** Installs a day at the end of the period, for the stats. */
  popularity: number;
}

const MODULES: ModuleSpec[] = [
  {
    id: "kai.map-pins",
    name: "Map Pins",
    dev: "kai",
    description: "Drop pins on any game map and share them with friends.",
    games: ["Elden Ring", "Enshrouded", "Baldur's Gate 3"],
    readme: "# Map Pins\n\nDrop a pin, name it, pick a colour.\n\n- Share pin sets with friends\n- Works next to the game\n",
    versions: [
      { version: "1.0.0", age: 150, notes: ["First version: pins, colours and names."] },
      { version: "1.1.0", age: 80, notes: ["Share a set of pins as a file.", "Pins keep their place when you resize the panel."] },
      { version: "1.2.0", age: 12, notes: ["Search your pins.", "Smaller and faster."] },
    ],
    quality: 4.5,
    ratings: 18,
    popularity: 14,
  },
  {
    id: "kai.loot-tracker",
    name: "Loot Tracker",
    dev: "kai",
    description: "Keep a list of the drops you want and tick them off.",
    games: ["Path of Exile 2", "Diablo IV"],
    readme: "# Loot Tracker\n\nA wish list for drops, one tick at a time.\n",
    versions: [
      { version: "1.0.0", age: 60, notes: ["First version."] },
      {
        version: "1.1.0",
        age: 1,
        notes: ["Looks up item prices online."],
        status: "waiting",
        reasons: [{ check: "permissions", text: "Asks to reach a new website.", detail: "api.lootdb.example.com is new for this module." }],
      },
    ],
    quality: 3.8,
    ratings: 6,
    popularity: 4,
  },
  {
    id: "lena.raid-timer",
    name: "Raid Timer",
    dev: "lena",
    description: "Countdowns for raid pulls, cooldowns and buff windows.",
    games: ["World of Warcraft", "Final Fantasy XIV"],
    readme: "# Raid Timer\n\nStart a countdown with one key. Keep a few presets per raid.\n",
    versions: [
      { version: "1.0.0", age: 200, notes: ["First version: countdowns and presets."] },
      { version: "1.1.0", age: 110, notes: ["Sound when a timer ends."] },
      { version: "1.2.0", age: 25, notes: ["Presets per character.", "Fixes a timer that kept running after closing the panel."] },
    ],
    quality: 4.3,
    ratings: 16,
    popularity: 9,
  },
  {
    id: "lena.guild-notes",
    name: "Guild Notes",
    dev: "lena",
    description: "Shared notes for your guild, kept on your PC.",
    games: [],
    readme: "# Guild Notes\n\nNotes for you and your guild.\n",
    versions: [{ version: "1.0.0", age: 90, notes: ["First version."] }],
    quality: 3,
    ratings: 4,
    popularity: 2,
  },
  {
    id: "wellbrained.timer",
    name: "Timer",
    dev: "wellbrained",
    description: "A simple timer and stopwatch that stays out of the way.",
    games: [],
    readme: "# Timer\n\nA timer, a stopwatch and nothing else.\n",
    versions: [
      { version: "1.0.0", age: 320, notes: ["First version."] },
      { version: "1.1.0", age: 150, notes: ["Several timers at once."] },
      { version: "1.2.0", age: 7, notes: ["Lap times for the stopwatch.", "A dark look."] },
    ],
    quality: 4.6,
    ratings: 18,
    popularity: 18,
  },
  {
    id: "wellbrained.dps-meter",
    name: "DPS Meter",
    dev: "wellbrained",
    description: "See your damage per second and compare it with your last run.",
    games: ["World of Warcraft", "Diablo IV"],
    readme: "# DPS Meter\n\nA live damage meter with history.\n",
    versions: [
      { version: "1.0.0", age: 100, notes: ["First version."] },
      { version: "1.1.0", age: 30, notes: ["Compare with your last run.", "Fixes wrong numbers after a long fight."] },
    ],
    quality: 3.9,
    ratings: 8,
    popularity: 6,
  },
  {
    id: "clickworks.click-counter",
    name: "Click Counter",
    dev: "clickworks",
    description: "Counts your clicks and keys per minute.",
    games: [],
    readme: "# Click Counter\n\nHow fast are you really?\n",
    versions: [
      { version: "1.0.0", age: 38, notes: ["First version."] },
      { version: "1.1.0", age: 15, notes: ["Fixes a crash on start."] },
    ],
    quality: 2.6,
    ratings: 7,
    popularity: 4,
  },
  {
    id: "clickworks.macro-pad",
    name: "Macro Pad",
    dev: "clickworks",
    description: "A grid of buttons that run your own key sequences.",
    games: [],
    readme: "# Macro Pad\n\nOne button, one key sequence.\n",
    versions: [
      {
        version: "1.0.0",
        age: 2,
        notes: ["First version."],
        status: "waiting",
        reasons: [
          { check: "first-module", text: "A new developer's first module." },
          { check: "permissions", text: "Asks to reach a new website.", detail: "macros.clickworks.example" },
        ],
      },
    ],
    quality: 3.5,
    ratings: 0,
    popularity: 0,
  },
  {
    id: "quickbuck.free-gold",
    name: "Free Gold",
    dev: "quickbuck",
    description: "Get gold fast.",
    games: ["Diablo IV"],
    readme: "# Free Gold\n\nGold. Fast.\n",
    versions: [
      { version: "1.0.0", age: 70, notes: ["First version."] },
      { version: "1.1.0", age: 66, notes: ["More gold."], status: "declined" },
    ],
    quality: 1.5,
    ratings: 3,
    popularity: 8,
  },
];

// ── Review texts ─────────────────────────────────────────────────────────

const POSITIVE = [
  "Does exactly what it says. Works great.",
  "Clean and quick, I use it every session.",
  "Saved me so much time, thanks!",
  "Love the layout, nothing extra.",
  "Solid. A dark theme would be nice, otherwise perfect.",
  "Been using it for weeks without a single problem.",
  "Small, fast and easy to set up.",
  "Exactly what I was missing.",
  "Funktioniert super, danke!",
];
const MIXED = [
  "Good idea, a few rough edges.",
  "Works, but the settings are confusing.",
  "Does the job. Needs a way to save presets.",
  "Nice, though it lags a little on my laptop.",
  "Gut, aber die Einstellungen sind unübersichtlich.",
];
const NEGATIVE = [
  "Stopped working after the last game patch.",
  "Too many clicks to do anything simple.",
  "Crashed twice in an hour, uninstalled.",
  "Not what the description promised.",
  "Settings reset every time I start the game.",
];
const REPLIES = ["Thanks for the kind words!", "Thanks, glad it helps.", "Sorry about that, a fix is on its way.", "Good point, I'll look at it.", "Thanks for the feedback, it's noted."];

// ── The seed ─────────────────────────────────────────────────────────────

export interface SeedOptions {
  stateDir: string;
  gamesFile: string;
  /** The moment everything is spread back from; now by default. */
  now?: number;
}

export function seedDev({ stateDir, gamesFile, now = Date.now() }: SeedOptions): SeedSummary {
  const random = makeRandom(20261028);
  const ago = (days: number) => Math.round(now - days * DAY);
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(path.dirname(path.resolve(gamesFile)), { recursive: true });

  // The games: a small dataset of well-known ones, built the way the real one is.
  const rows = buildDataset({ builtIns: [], wikidata: [], steam: GAMES.map((game, index) => ({ appid: 1_000_000 + index * 10, name: game.name })) });
  rows.forEach((row) => {
    const aliases = GAMES.find((game) => game.name === row.name)?.aliases ?? [];
    row.aliases.push(...aliases);
  });
  rmSync(gamesFile, { force: true });
  writeDatabase(gamesFile, rows, new Date(now)).close();
  const gameId = (name: string) => rows.find((row) => row.name === name)?.id ?? (() => { throw new Error(`No game ${name}`); })();

  const accounts = new AccountStore(path.join(stateDir, "accounts.sqlite"));
  const catalog = new CatalogStore(path.join(stateDir, "catalog"));
  const reviews = new ReviewStore(path.join(stateDir, "reviews.sqlite"));
  const conversations = new ConversationStore(path.join(stateDir, "conversations.sqlite"));
  const copies = new CopyStore(path.join(stateDir, "copies.sqlite"));
  const state = new IconState(path.join(stateDir, "icons.sqlite"));
  const activity = new ActivityLog(path.join(stateDir, "activity.sqlite"));
  const stats = new StatsStore(path.join(stateDir, "stats.sqlite"));

  // Accounts: email, Discord-only and both; sessions are made at the time they were last used.
  const who = new Map<string, Account>();
  ACCOUNTS.forEach((spec, index) => {
    const created = ago(spec.age);
    const account = accounts.createAccount(
      { ...(spec.email ? { email: spec.email } : {}), ...(spec.discord ? { discord: { id: String(412_345_678_901_234_000n + BigInt(index)), name: spec.discord } } : {}) },
      created,
    );
    who.set(spec.key, account);
    if (spec.name) accounts.setProfile(account.id, { name: spec.name, initials: spec.name.slice(0, 2).toUpperCase(), picture: spec.picture ? Buffer.from(picture(64, index + 3)) : null, updatedAt: created });
    for (const device of spec.devices) accounts.createSession(account.id, device.os, ago(device.used), device.name);
  });
  const id = (key: string) => who.get(key)!.id;

  // Developers: a name, a prefix and a publisher key each (Kai has a second one, and asks to replace the first).
  const keys = new Map<string, KeyObject>();
  for (const [index, key] of ["kai", "lena", "wellbrained", "clickworks", "quickbuck"].entries()) {
    const privateKey = keyFromSeed(random.bytes(32));
    keys.set(key, privateKey);
    const spec = ACCOUNTS.find((entry) => entry.key === key)!;
    const linkedAt = ago(spec.age - 1 - index);
    const named = accounts.setDeveloperName(id(key), spec.name!, linkedAt);
    if (!named.ok) throw new Error(`Developer name ${spec.name}: ${named.reason}`);
    if (accounts.linkKey(id(key), keyFingerprint(rawPublic(privateKey)), rawPublic(privateKey).toString("base64"), linkedAt) !== "ok") throw new Error(`Key of ${key} not linked`);
    accounts.reservePrefix(id(key), key, linkedAt);
  }
  const kaiSecond = keyFromSeed(random.bytes(32));
  accounts.linkKey(id("kai"), keyFingerprint(rawPublic(kaiSecond)), rawPublic(kaiSecond).toString("base64"), ago(2));
  accounts.requestReplacement(id("kai"), keyFingerprint(rawPublic(keys.get("kai")!)), keyFingerprint(rawPublic(kaiSecond)), true, ago(1));

  // The catalog: real signed zips, added at the time they were published.
  const sha = new Map<string, string>();
  const zipOf = (module: ModuleSpec, version: ModuleSpec["versions"][number]) => {
    const manifest = {
      id: module.id,
      name: module.name,
      description: module.description,
      version: version.version,
      apiVersion: "1",
      entry: "index.html",
      icon: "icon.png",
      changelog: "changelog.json",
      readme: "README.md",
      games: module.games.map(gameId),
      viewport: { minWidth: 240, minHeight: 160 },
      permissions: { network: version.reasons?.some((reason) => reason.check === "permissions") ? ["api.example.com"] : [] },
    };
    const history = module.versions.filter((entry) => module.versions.indexOf(entry) <= module.versions.indexOf(version)).reverse();
    const files: ZipFile[] = [
      { name: "tavora.module.json", data: Buffer.from(JSON.stringify(manifest)) },
      { name: "index.html", data: Buffer.from(`<!doctype html><title>${module.name}</title><p>${module.name} ${version.version}</p>`) },
      { name: "changelog.json", data: Buffer.from(JSON.stringify(history.map((entry) => ({ version: entry.version, notes: entry.notes })))) },
      { name: "README.md", data: Buffer.from(module.readme) },
      { name: "icon.png", data: Buffer.from(picture(64, module.id.length * 7 + module.id.charCodeAt(0))) },
      { name: "assets/bundle.js", data: random.bytes(random.int(8_000, 90_000)) },
    ];
    return writeZip([...files, signFiles(files, keys.get(module.dev)!)]);
  };
  for (const module of MODULES) {
    for (const version of module.versions) {
      const at = new Date(ago(version.age));
      const waiting = version.status === "waiting" || version.status === "declined";
      const checked = catalog.add(zipOf(module, version), at, id(module.dev), undefined, undefined, waiting ? { reasons: version.reasons ?? [{ check: "words", text: "The word filter found something." }], language: "en", token: version.status === "waiting" ? null : "GitHub Actions" } : undefined);
      sha.set(`${module.id}@${version.version}`, checked.sha256);
      if (!waiting && module.dev !== "clickworks") catalog.trustAccount(id(module.dev), at);
    }
  }
  // Clickworks was approved once (Click Counter), so only its new first-module check holds Macro Pad.
  catalog.trustAccount(id("clickworks"), new Date(ago(38)));
  // QuickBuck's second version was declined and removed; the ban unlisted the module.
  const declined = catalog.waitingVersion(sha.get("quickbuck.free-gold@1.1.0")!)!;
  catalog.recordDeclined(declined, "spam", "Promises gold without playing.", new Date(ago(65)));
  catalog.removeWaiting(declined.sha256);
  // Click Counter 1.0.0 crashes Tavora: a block waits to be signed.
  catalog.setState("staged_blocks", JSON.stringify([{ sha256: sha.get("clickworks.click-counter@1.0.0"), reason: "Crashes on start", stagedAt: new Date(ago(14)).toISOString() }]));

  // Installs from Browse, per module.
  for (const module of MODULES) {
    const installs = module.popularity * module.versions[0]!.age * 0.6;
    for (let i = 0; i < Math.round(installs); i += 1) catalog.countInstall(module.id);
  }

  // Open reports of modules, with who sent them.
  const reportAs = (key: string, versionKey: string, reporter: string, reason: string, note: string | null, daysAgo: number) => {
    const module = MODULES.find((entry) => versionKey.startsWith(`${entry.id}@`))!;
    const owner = keyFingerprint(rawPublic(keys.get(module.dev)!));
    if (!catalog.report({ id: module.id, owner, sha256: sha.get(versionKey)! }, new Date(ago(daysAgo)), { accountId: id(reporter), reason, note })) throw new Error(`Report ${key} refused`);
  };
  reportAs("a", "clickworks.click-counter@1.1.0", "mara", "broken", "Crashes when I press F5.", 6);
  reportAs("b", "clickworks.click-counter@1.1.0", "jonas", "broken", null, 4);
  reportAs("c", "wellbrained.dps-meter@1.1.0", "tom", "other", "The numbers are far too high in WoW.", 3);
  reportAs("d", "kai.loot-tracker@1.0.0", "priya", "other", "It asked for my login on a website.", 9);
  reportAs("e", "kai.loot-tracker@1.0.0", "hannah", "other", null, 8);
  reportAs("f", "kai.loot-tracker@1.0.0", "luca", "other", "Does not track anything in Diablo IV.", 5);

  // Ratings and reviews over the last 120 days, oldest first so the daily-limit log stays right.
  interface Plan { user: string; module: ModuleSpec; stars: number; text: string | null; at: number; flag?: "words" | "link" | "capped" | "hidden" | "report" }
  const plans: Plan[] = [];
  const authors = ACCOUNTS.filter((spec) => !["quickbuck", "noah", "fresh", "chloe", "rob"].includes(spec.key));
  const taken = new Set<string>();
  for (const module of MODULES) {
    const first = ago(module.versions[0]!.age);
    for (let n = 0; n < module.ratings; n += 1) {
      const candidates = authors.filter((spec) => spec.key !== module.dev && !taken.has(`${spec.key}|${module.id}`));
      const spec = random.pick(candidates);
      taken.add(`${spec.key}|${module.id}`);
      const earliest = Math.max(first + HOUR, ago(spec.age) + 25 * HOUR, now - 120 * DAY);
      const latest = module.id === "quickbuck.free-gold" ? ago(61) : module.id === "lena.guild-notes" ? ago(22) : now - 2 * HOUR;
      const at = Math.round(earliest + random.next() * Math.max(0, latest - earliest));
      const stars = Math.max(1, Math.min(5, Math.round(module.quality + random.gauss() * 1.1)));
      const text = random.chance(0.6) ? random.pick(stars >= 4 ? POSITIVE : stars === 3 ? MIXED : NEGATIVE) : null;
      plans.push({ user: spec.key, module, stars, text, at });
    }
  }
  // Rob's reviews, which the suspension hides.
  for (const [moduleId, daysAgo] of [["kai.map-pins", 52], ["lena.raid-timer", 51], ["wellbrained.timer", 50]] as const) {
    plans.push({ user: "rob", module: MODULES.find((m) => m.id === moduleId)!, stars: 5, text: "Best module ever! Everyone should also see my page.", at: ago(daysAgo - 1) });
  }
  // The special cases: words, links, the module cap, hidden by hand, reported.
  const special = (flag: NonNullable<Plan["flag"]>, count: number, filter: (plan: Plan) => boolean) => {
    plans.filter((plan) => plan.user !== "rob" && !plan.flag && filter(plan)).slice(0, count).forEach((plan) => (plan.flag = flag));
  };
  special("words", 2, (plan) => plan.module.id === "clickworks.click-counter" && plan.stars <= 3);
  special("link", 2, (plan) => plan.module.id === "kai.map-pins");
  for (const plan of plans.filter((entry) => entry.flag === "words")) (plan.stars = 1), (plan.text = "kys devs, this broke my layout");
  for (const plan of plans.filter((entry) => entry.flag === "link")) (plan.stars = 5), (plan.text = "Nice tool! More free tools at www.free-tools.xyz");
  // Three ratings of Timer in the last day go over its daily limit.
  const cap = plans.filter((plan) => plan.module.id === "wellbrained.timer" && !plan.flag).slice(-3);
  for (const [index, plan] of cap.entries()) (plan.flag = "capped"), (plan.at = now - (3 + index * 4) * HOUR), (plan.text ??= "Works well for me.");
  special("hidden", 4, (plan) => plan.text !== null && plan.stars <= 3 && plan.at < now - 20 * DAY);
  special("report", 3, (plan) => plan.text !== null && plan.stars <= 3);
  for (const plan of plans.filter((entry) => entry.flag === "words" || entry.flag === "link")) {
    if (checkReviewText(plan.text!) === "ok") throw new Error(`The held text "${plan.text}" passes the filter`);
  }
  plans.sort((a, b) => a.at - b.at);

  const reviewOf = new Map<Plan, string>();
  for (const plan of plans) {
    const published = plan.module.versions.filter((v) => v.status === undefined && now - v.age * DAY <= plan.at).at(-1) ?? plan.module.versions[0]!;
    const held = plan.flag === "words" || plan.flag === "link";
    const stored = reviews.rate(id(plan.user), plan.module.id, { stars: plan.stars, text: plan.text, version: published.version, ...(held ? { held: true } : {}), ...(plan.flag === "capped" ? { capped: true } : {}) }, plan.at);
    reviewOf.set(plan, stored.id);
  }
  // Developers answer about a third of the reviews with text; the rest stay unanswered.
  let answered = 0;
  for (const plan of plans) {
    const reviewId = reviewOf.get(plan)!;
    if (plan.text === null || plan.flag === "words" || plan.flag === "link" || plan.flag === "capped" || plan.user === "rob" || !random.chance(0.4) || answered >= 16) continue;
    reviews.setReply(reviewId, random.pick(REPLIES), plan.at + random.int(2, 40) * HOUR);
    answered += 1;
  }
  // Reports of reviews, with who reported them (the report is kept while it is open).
  const reporters = ["mara", "jonas", "priya", "tom", "sofia"];
  plans.filter((plan) => plan.flag === "report").forEach((plan, index) => {
    for (const reporter of reporters.filter((key) => key !== plan.user).slice(0, index + 1)) reviews.report(reviewOf.get(plan)!, id(reporter), now - (index + 1) * DAY);
  });
  for (const plan of plans.filter((entry) => entry.flag === "hidden")) reviews.setHidden(reviewOf.get(plan)!, true);
  // Reviews older than a week were looked at; newer ones with text wait in the admin's queue.
  reviews.markSeen([...reviewOf].filter(([plan]) => plan.at < now - 8 * DAY).map(([, reviewId]) => reviewId));

  // Rob spammed: suspended, and his reviews hidden with it.
  reviews.hideForSuspension(id("rob"));
  accounts.suspend(id("rob"), "spam", "Posted the same link in several reviews.", ago(49));
  // QuickBuck is banned and its module taken down with the ban.
  catalog.setListed("quickbuck.free-gold", false);
  accounts.ban(id("quickbuck"), "spam", "Fake promises, declined once already.", ["quickbuck.free-gold"], ago(60));
  // Guild Notes was taken down by hand.
  catalog.setListed("lena.guild-notes", false);

  // Conversations: users with developers, and Tavora with accounts.
  const versions = (moduleId: string) => ({ tavora: "0.21.50", module: MODULES.find((module) => module.id === moduleId)!.versions.filter((v) => v.status === undefined).at(-1)!.version });
  const moduleName = (moduleId: string) => MODULES.find((module) => module.id === moduleId)!.name;
  const request = (user: string, moduleId: string, type: "bug" | "feature" | "question", text: string, at: number, previousId: string | null = null): Conversation =>
    conversations.startDeveloper({ moduleId, moduleName: moduleName(moduleId), developerAccountId: id(MODULES.find((m) => m.id === moduleId)!.dev), userAccountId: id(user), type, text, versions: versions(moduleId), previousId }, at);
  const developerSays = (conversation: Conversation, text: string, at: number) => conversations.addMessage(conversation.id, "developer", conversation.developerAccountId, text, at);
  const userSays = (conversation: Conversation, user: string, text: string, at: number) => conversations.addMessage(conversation.id, "user", id(user), text, at);

  const c1 = request("mara", "kai.map-pins", "bug", "My pins vanish when I resize the panel.", ago(6));
  developerSays(c1, "Thanks, I can reproduce it. A fix comes with the next version.", ago(5));
  userSays(c1, "mara", "Great, thanks!", ago(4));
  conversations.markRead(c1.id, "other");
  const c2 = request("jonas", "lena.raid-timer", "bug", "The timer keeps running after I close the panel.", ago(40));
  developerSays(c2, "Found it, fixed in 1.2.0.", ago(36));
  conversations.markRead(c2.id, "user");
  conversations.closeConversation(c2.id, "fixed", ago(34));
  const c3 = request("priya", "wellbrained.timer", "feature", "Could you add a lap counter?", ago(20));
  developerSays(c3, "Good idea, adding it.", ago(19));
  conversations.closeConversation(c3.id, "added", ago(7));
  const c4 = request("sofia", "wellbrained.timer", "feature", "Please add a sound alert per timer.", ago(60));
  developerSays(c4, "Thanks. I want to keep it simple, so not planned for now.", ago(58));
  conversations.closeConversation(c4.id, "not-planned", ago(50));
  const c5 = request("hannah", "kai.map-pins", "question", "Does this work with the Enshrouded map?", ago(2));
  void c5;
  const c6 = request("tom", "wellbrained.dps-meter", "question", "Does it count pet damage?", ago(30));
  developerSays(c6, "Yes, pet damage is included.", ago(29));
  userSays(c6, "tom", "Perfect, thanks.", ago(29));
  conversations.closeConversation(c6.id, "user", ago(14));
  const c7 = request("ben", "lena.raid-timer", "bug", "Presets are gone after an update.", ago(75));
  developerSays(c7, "Presets live in the game profile; they were reset by the game patch, not by the module.", ago(72));
  conversations.closeConversation(c7.id, "not-a-bug", ago(70));
  const c8 = request("luca", "clickworks.click-counter", "bug", "The counter shows nothing in my game.", ago(28));
  userSays(c8, "luca", "Still the same on 1.1.0.", ago(28) + HOUR);
  const c9 = request("zed", "clickworks.click-counter", "bug", "This is garbage, fix your trash module you idiots.", ago(8));
  developerSays(c9, "Please keep it civil. What happens exactly?", ago(8) + HOUR);
  userSays(c9, "zed", "Just fix it, idiots.", ago(7));
  conversations.report(c9.id, id("clickworks"), "insults", "Insults in two messages in a row.", ago(7) + HOUR);
  const c10 = request("omar", "kai.loot-tracker", "question", "Can it track Diablo IV season loot?", ago(33));
  developerSays(c10, "Not yet, it follows items you add by hand.", ago(32));
  conversations.closeConversation(c10.id, "none", ago(30));
  request("ben", "lena.raid-timer", "feature", "Could a timer repeat by itself?", ago(18), c7.id);

  const t1 = conversations.startTavora({ userAccountId: id("clickworks"), text: "Hi, users reported Click Counter 1.1.0 as crashing. Could you take a look?", about: { type: "module-report", id: "clickworks.click-counter" }, moduleId: "clickworks.click-counter", moduleName: "Click Counter" }, ago(5));
  conversations.addMessage(t1.id, "user", id("clickworks"), "Thanks for telling us, we are on it and will ship a fix this week.", ago(4));
  const t2 = conversations.startTavora({ userAccountId: id("rob"), text: "Your reviews all link to the same page. Please stop, or your account is suspended.", about: { type: "review", id: "spam" }, moduleId: null, moduleName: null }, ago(51));
  conversations.closeConversation(t2.id, "tavora", ago(49));
  conversations.startTavora({ userAccountId: id("emma"), text: "Hi Emma, we saw your report of a review and wanted to say thanks. Nothing else to do from your side.", about: { type: "review-report", id: "thanks" }, moduleId: null, moduleName: null }, ago(3));
  const t4 = conversations.startTavora({ userAccountId: id("hannah"), text: "Your account was signed in from a new PC. Was this you?", about: { type: "account", id: id("hannah") }, moduleId: null, moduleName: null }, ago(25));
  conversations.addMessage(t4.id, "user", id("hannah"), "Yes, that was me, I got a new laptop.", ago(24));
  conversations.closeConversation(t4.id, "tavora", ago(24));
  conversations.setContact("clickworks.click-counter", true, "https://clickworks.example/support");
  conversations.setText("inbox.appeared.tavora", "Tavora wrote to you.", "Tavora hat dir geschrieben.");
  conversations.setText("inbox.gone", `${builtInTexts()["inbox.gone"].en} Thanks for your patience.`, `${builtInTexts()["inbox.gone"].de} Danke für deine Geduld.`);

  // Icon offers waiting for review, and two already approved.
  const offer = (game: string, sender: string, hue: number, daysAgo: number, source: "installed" | "steam" | "other" = "installed", times = 1) => {
    const bytes = picture(128, hue);
    const hash = createHash("sha256").update(bytes).digest("hex");
    for (let n = 0; n < times; n += 1) state.addPending({ sha256: hash, id: gameId(game), name: game, source, bytes, sender: id(sender), now: new Date(ago(daysAgo) + n * HOUR) });
    return hash;
  };
  offer("Enshrouded", "mara", 11, 6);
  offer("Palworld", "jonas", 12, 5, "steam", 3);
  offer("Helldivers 2", "priya", 13, 4);
  offer("Lethal Company", "ayla", 14, 2, "other");
  offer("Last Epoch", "pixelpete", 15, 1);
  state.approve(offer("Hades", "ben", 16, 40), ["Hades"], new Date(ago(38)));
  state.approve(offer("Valheim", "sofia", 17, 22), ["Valheim"], new Date(ago(20)));

  // Cloud copies of a few accounts.
  for (const [index, key] of ["kai", "mara", "priya", "sofia", "hannah", "emma"].entries()) {
    const parts = Array.from({ length: random.int(2, 6) }, () => ({ id: new Uint8Array(createHash("sha256").update(random.bytes(8)).digest()), data: random.bytes(random.int(20_000, 400_000)) }));
    copies.addParts(id(key), parts);
    const result = copies.swap(id(key), 0, random.bytes(600), parts.map((part) => part.id), ago(index * 3 + 0.5));
    if (!result.ok) throw new Error(`Copy of ${key} refused`);
  }

  // The activity log: what the maintainer did, back-dated.
  const person = (key: string) => ({ type: "account", id: id(key), label: ACCOUNTS.find((spec) => spec.key === key)!.name });
  const versionTarget = (versionKey: string) => ({ type: "version", id: versionKey, label: `${moduleName(versionKey.split("@")[0]!)} ${versionKey.split("@")[1]}` });
  const moduleTarget = (moduleId: string) => ({ type: "module", id: moduleId, label: moduleName(moduleId) });
  type Entry = Parameters<ActivityLog["record"]>[0];
  const entries: Entry[] = [];
  const log = (daysAgo: number, kind: string, target: Entry["target"], extra: Partial<Entry> = {}) => entries.push({ at: ago(daysAgo), kind, target, ...extra });
  // Every version beyond the first of a developer who was not trusted yet was approved by hand.
  for (const module of MODULES) {
    for (const version of module.versions) {
      if (version.status === undefined && version.age < 40 && module.dev !== "quickbuck") log(version.age - 0.2, "moderation/approve", versionTarget(`${module.id}@${version.version}`), { detail: { mailed: true } });
    }
  }
  log(65, "moderation/decline", versionTarget("quickbuck.free-gold@1.1.0"), { reason: "spam", note: "Promises gold without playing.", detail: { mailed: true } });
  log(60, "moderation/ban", person("quickbuck"), { reason: "spam", note: "Fake promises, declined once already.", detail: { mailed: true, declined: 0 } });
  log(49, "accounts/suspend", person("rob"), { reason: "spam", note: "Posted the same link in several reviews.", detail: { mailed: true, signedOut: 1 } });
  log(49, "accounts/hide-reviews", person("rob"), { detail: { hidden: 3 } });
  log(20, "catalog/listed", moduleTarget("lena.guild-notes"), { reason: "broken", note: "Does not start on current Tavora.", detail: { listed: false } });
  log(38, "approve", { type: "approve", id: gameId("Hades"), label: "Hades" }, { detail: { names: 1 } });
  log(20, "approve", { type: "approve", id: gameId("Valheim"), label: "Valheim" }, { detail: { names: 1 } });
  log(45, "deny", { type: "deny", id: gameId("Rust"), label: "Rust" }, { reason: "Not an icon of the game." });
  log(33, "replaceable", { type: "replaceable", id: gameId("Elden Ring"), label: "Elden Ring" }, { detail: { replaceable: true } });
  log(30, "takedown", { type: "takedown", id: gameId("Minecraft"), label: "Minecraft" }, { note: "Asked for by the rights holder." });
  for (const [daysAgo, ratingIndex] of [[100, 0], [86, 1], [72, 2], [58, 3]] as const) {
    const plan = plans.filter((entry) => entry.text !== null && entry.at < now - daysAgo * DAY + 10 * DAY)[ratingIndex];
    if (plan) log(daysAgo, "reviews/seen", { type: "review", id: reviewOf.get(plan)!, label: null });
  }
  for (const plan of plans.filter((entry) => entry.flag === "hidden")) log(Math.max(1, (now - plan.at) / DAY - 3), "reviews/hidden", { type: "review", id: reviewOf.get(plan)!, label: null }, { reason: "insults", detail: { hidden: true } });
  log(35, "reviews/approve", { type: "review", id: "held", label: null }, { note: "False alarm of the word filter." });
  log(27, "reviews/remove", { type: "review", id: "spam-1", label: null }, { reason: "spam" });
  log(18, "reviews/dismiss", { type: "review", id: "fine", label: null }, { note: "Honest opinion." });
  log(56, "reports/dismiss", { type: "module", id: "kai.map", label: "Map Pins" }, { note: "Works as described." });
  log(41, "reports/dismiss", { type: "module", id: "wellbrained", label: "Timer" });
  log(26, "accounts/unsuspend", person("ben"), { note: "Misunderstanding, cleared up by email." });
  log(15, "accounts/suspend", person("ben"), { reason: "other", detail: { signedOut: 1 } });
  log(50, "messages/start", person("rob"), { detail: { mailed: true } });
  log(5, "messages/start", person("clickworks"), { detail: { mailed: true } });
  log(24, "messages/close", { type: "conversation", id: t4.id, label: null });
  log(25, "messages/start", person("hannah"));
  log(7, "messages/dismiss-report", { type: "conversation", id: "earlier", label: null }, { note: "Not insulting after all." });
  log(37, "texts", { type: "text", id: "inbox.gone", label: null }, { note: "Added a thank-you line." });
  log(12, "texts", { type: "text", id: "inbox.appeared.tavora", label: null });
  log(9, "keys/decline", person("lena"), { note: "The old key is still in use." });
  log(75, "moderation/approve", versionTarget("kai.map-pins@1.1.0"), { detail: { mailed: false } });
  log(95, "moderation/unban", person("zed"), { detail: { relisted: 0 } });
  log(2, "reviews/seen", { type: "review", id: "recent", label: null });
  entries.sort((a, b) => a.at - b.at).forEach((entry) => activity.record(entry));

  // Stats: 365 days of counts and the account snapshots, with growth, weekends and bumps after releases.
  const releaseAges = [362, 321, 300, 276, 254, 231, 210, 187, 165, 140, 118, 96, 72, 50, 32, 14, 3];
  const appVersion = (index: number) => `0.21.${55 - (releaseAges.length - 1 - index)}`;
  const counts: { day: string; kind: string; key: string; count: number }[] = [];
  const growth = (age: number) => 1 + (3 * (365 - age)) / 365;
  const weekend = (at: number) => ([0, 6].includes(new Date(at).getUTCDay()) ? 1.3 : 1);
  const noise = () => 0.8 + random.next() * 0.4;
  const releaseDays = (at: number) => releaseAges.map((age) => Math.floor((now - age * DAY) / DAY) * DAY).filter((day) => day <= at);
  const accountsSnapshots: { at: number; total: number; active7: number; active30: number }[] = [];
  const createdAts = ACCOUNTS.map((spec) => ago(spec.age)).sort((a, b) => a - b);
  for (let age = 364; age >= 0; age -= 1) {
    const at = now - age * DAY;
    const day = utcDay(at);
    const users = 20 * growth(age);
    const releasedNow = releaseDays(at);
    const latest = releasedNow.length - 1;
    if (latest >= 0) counts.push({ day, kind: "app-installer", key: appVersion(latest), count: Math.round(users * 0.12 * weekend(at) * noise()) });
    for (const [index, releaseDay] of releasedNow.entries()) {
      const since = Math.floor((at - releaseDay) / DAY);
      if (since <= 5) counts.push({ day, kind: "app-update", key: appVersion(index), count: Math.round(users * 0.7 * 0.45 ** since * weekend(at) * noise()) });
    }
    for (const module of MODULES) {
      const first = module.versions[0]!.age;
      const end = module.id === "lena.guild-notes" ? 20 : module.id === "quickbuck.free-gold" ? 60 : 0;
      if (age > first || age < end || module.popularity === 0) continue;
      const ramp = Math.min(1, (first - age) / 20 + 0.2);
      counts.push({ day, kind: "module-install", key: module.id, count: Math.round(module.popularity * ramp * (1 + (first - age) / 200) * weekend(at) * noise()) });
      for (const version of module.versions.slice(1)) {
        const since = Math.floor(version.age - age) * -1;
        if (version.status === undefined && since >= 0 && since <= 6) counts.push({ day, kind: "module-update", key: module.id, count: Math.round(module.popularity * 5 * 0.5 ** since * noise()) });
      }
    }
    const total = createdAts.filter((created) => created <= at).length;
    if (total > 0) {
      const active30 = Math.min(total, Math.round(total * (0.55 + random.next() * 0.1)));
      accountsSnapshots.push({ at, total, active7: Math.min(active30, Math.round(active30 * (0.5 + random.next() * 0.1))), active30 });
    }
  }
  // Today's numbers are the real ones, since the server writes them itself when the day has none.
  accountsSnapshots.pop();
  for (const snapshot of accountsSnapshots) stats.snapshotAccounts(snapshot, snapshot.at);
  stats.snapshotAccounts(accounts.activity(now), now);
  stats.close();
  // StatsStore.count adds one at a time and commits each; a year of counts that way takes minutes, so the totals are written
  // in one transaction. Same table and format as the store's own.
  const raw = new DatabaseSync(path.join(stateDir, "stats.sqlite"));
  raw.exec("begin");
  const insert = raw.prepare("insert into daily_counts (day, kind, key, count) values (?, ?, ?, ?) on conflict (day, kind, key) do update set count = count + excluded.count");
  for (const row of counts) if (row.count > 0 && (STAT_KINDS as readonly string[]).includes(row.kind)) insert.run(row.day, row.kind, row.key, row.count);
  raw.exec("commit");
  const statRows = (raw.prepare("select count(*) as n from daily_counts").get() as { n: number }).n;
  const statDays = (raw.prepare("select count(distinct day) as n from daily_counts").get() as { n: number }).n;
  raw.close();

  // The summary, read back from the stores.
  const adminModules = catalog.adminModules();
  const allReviews = adminModules.flatMap((module) => reviews.byModule(module.id));
  const summary: SeedSummary = {
    games: rows.length,
    accounts: accounts.accountRows().length,
    developers: accounts.accountRows().filter((row) => row.developerName !== null).length,
    suspended: accounts.accountRows().filter((row) => row.suspended).length,
    banned: accounts.accountRows().filter((row) => row.banned).length,
    modules: adminModules.length,
    versions: adminModules.reduce((sum, module) => sum + module.versions.length, 0),
    waitingVersions: catalog.waitingVersions().length,
    unlistedModules: adminModules.filter((module) => !module.listed).length,
    openModuleReports: catalog.reports().length,
    blocksToSign: (JSON.parse(catalog.getState("staged_blocks") ?? "[]") as unknown[]).length,
    reviews: allReviews.length,
    reviewsHeld: allReviews.filter((review) => review.held && !review.capped).length,
    reviewsCapped: allReviews.filter((review) => review.capped).length,
    reviewsHidden: allReviews.filter((review) => review.hidden).length,
    reviewsInQueue: reviews.queue().length,
    reviewsReported: reviews.reports().length,
    conversations: ACCOUNTS.flatMap((spec) => conversations.listFor(id(spec.key))).filter((value, index, all) => all.findIndex((other) => other.id === value.id) === index).length,
    tavoraConversations: conversations.tavoraConversations().length,
    reportedConversations: conversations.reportedConversations().length,
    iconOffers: state.pendingCount(),
    iconsApproved: state.approvedList().length,
    keyRequests: accounts.allKeyRequests().length,
    cloudCopies: ACCOUNTS.filter((spec) => copies.info(id(spec.key)) !== null).length,
    statDays,
    statRows,
    activityEntries: activity.list({ limit: 200 }).entries.length,
  };
  for (const store of [accounts, catalog, reviews, conversations, state, activity]) store.close();
  return summary;
}

// ── Command line ─────────────────────────────────────────────────────────

/** Whether a folder holds anything. */
const hasData = (dir: string) => existsSync(dir) && readdirSync(dir).length > 0;

/** Refuses folders that would be a disaster to delete: a root, the home folder, or anything holding the current folder. */
function safeToDelete(dir: string): boolean {
  const target = path.resolve(dir);
  const relation = path.relative(target, process.cwd());
  const holdsCwd = relation === "" || (!relation.startsWith("..") && !path.isAbsolute(relation));
  return path.parse(target).root !== target && target !== os.homedir() && !holdsCwd && target.split(path.sep).filter(Boolean).length >= 2;
}

function main(argv: string[]): number {
  const { values } = parseArgs({ args: argv, options: { state: { type: "string" }, games: { type: "string" }, fresh: { type: "boolean", default: false } }, strict: true });
  if (!values.state || !values.games) {
    console.error("Usage: node --conditions=source apps/api/scripts/seed-dev.ts --state <dir> --games <file> [--fresh]");
    return 2;
  }
  const stateDir = path.resolve(values.state);
  if (hasData(stateDir)) {
    if (!values.fresh) {
      console.error(`${stateDir} already has data. Nothing was changed. Pass --fresh to delete that folder and seed it again.`);
      return 1;
    }
    if (!safeToDelete(stateDir)) {
      console.error(`Refusing to delete ${stateDir}: it is a root, your home folder, or holds the current folder.`);
      return 1;
    }
    rmSync(stateDir, { recursive: true, force: true });
  }
  const summary = seedDev({ stateDir, gamesFile: path.resolve(values.games) });
  console.log(`Seeded fake development data into ${stateDir} (games: ${path.resolve(values.games)}).`);
  console.log(
    [
      `${summary.accounts} accounts (${summary.developers} developers, ${summary.suspended} suspended, ${summary.banned} banned)`,
      `${summary.modules} modules, ${summary.versions} versions (${summary.waitingVersions} waiting, ${summary.unlistedModules} unlisted, ${summary.blocksToSign} block to sign)`,
      `${summary.reviews} ratings (${summary.reviewsHeld} held, ${summary.reviewsCapped} capped, ${summary.reviewsHidden} hidden, ${summary.reviewsInQueue} in the queue, ${summary.reviewsReported} reported)`,
      `${summary.openModuleReports} module reports, ${summary.keyRequests} key request`,
      `${summary.conversations} conversations (${summary.tavoraConversations} with Tavora, ${summary.reportedConversations} reported)`,
      `${summary.iconOffers} icon offers, ${summary.iconsApproved} icons approved, ${summary.cloudCopies} cloud copies`,
      `${summary.statDays} days of stats (${summary.statRows} rows), ${summary.activityEntries} activity entries, ${summary.games} games`,
    ].join("\n"),
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
