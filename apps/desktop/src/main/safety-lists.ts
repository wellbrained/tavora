import path from "node:path";
import {
  CATALOG_LIST_KINDS,
  isNewerCatalogList,
  MAX_CATALOG_LIST_BYTES,
  readCatalogList,
  type Block,
  type CatalogListKind,
  type CatalogListOf,
} from "@tavora/pack";
import { writeFileAtomic } from "./fsutil";
import type { OwnerRecords } from "./installer";
import { readJsonOrSetAside } from "./json";
import type { InstalledModule, ModuleProblem } from "./registry";

// The catalog's safety lists (catalog threat model, C6, C7, C14), signed
// offline with Tavora's catalogue key by scripts/catalog-sign.ts and served by
// the Tavora service as plain files. The app trusts only the signature: a list
// signed by another key, or older than the one it holds, is ignored, so a
// server that was broken into can at most hold a newer list back.
//   revocations  publisher keys that no longer sign, with the zips each signed
//                before that stay accepted
//   blocks       zips Tavora stopped; installed copies are disabled, their data kept
//   successions  a new key that replaces an account's lost one; data stays with the first key
// The lists are asked for like the hosted icons: only while online features are on,
// with no cookies, no referrer and nothing that says who asks.

/**
 * Tavora's catalogue public key: the raw Ed25519 public half, base64, made offline with
 * `pnpm tavora-catalog-sign key <file>` (2026-10-18). Only lists signed by its secret half count.
 * A new key here makes every list signed by the old one count for nothing.
 */
export const CATALOGUE_PUBLIC_KEY = "u44xg/sgGpnPfBN5o8n/xyBU5Xrv3G/ZJC20+phjWIU=";

export const SAFETY_TIMEOUT_MS = 10_000;
/** How often a running Tavora asks again. */
export const SAFETY_REFRESH_MS = 6 * 60 * 60_000;
/** Longest chain of successions followed; more is not a real account's history. */
const MAX_SUCCESSIONS = 16;

export interface SafetyListsOptions {
  /** Where the signed files are kept on this PC. */
  file: string;
  baseUrl: string;
  /** Raw catalogue public key, base64 (CATALOGUE_PUBLIC_KEY outside tests). */
  publicKey: string;
  /** Whether the player allows Tavora to ask its service (Settings > Online). */
  online: () => boolean;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

type Held = { [K in CatalogListKind]: { list: CatalogListOf<K>; text: string } | null };

/** What the installer asks before it installs a zip. */
export interface SafetyCheck {
  /** The block on a zip (its SHA-256), or null. */
  blocked(sha256: string): Block | null;
  /** Whether a key is revoked and this zip is not one it signed before. */
  revoked(fingerprint: string, sha256: string): boolean;
  /** The first key of a key's account by its successions: whose data its modules use. */
  firstKey(fingerprint: string): string;
}

export class SafetyLists implements SafetyCheck {
  private held: Held = { revocations: null, blocks: null, successions: null };
  private readonly baseUrl: string;

  constructor(private readonly options: SafetyListsOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
  }

  /** Reads the lists kept on this PC, checking each signature again. */
  async load(): Promise<void> {
    const saved = await readJsonOrSetAside<Record<string, unknown>>(this.options.file);
    for (const kind of CATALOG_LIST_KINDS) {
      const text = saved?.[kind];
      if (typeof text === "string") this.accept(kind, text);
    }
  }

  /** The list of a kind held now, or null. */
  list<K extends CatalogListKind>(kind: K): CatalogListOf<K> | null {
    return (this.held[kind]?.list as CatalogListOf<K> | undefined) ?? null;
  }

  /** Takes a signed file when it is a list of this kind from the catalogue key and newer than the one held. */
  accept(kind: CatalogListKind, text: string): boolean {
    const list = readCatalogList(kind, text, this.options.publicKey);
    if (!list || !isNewerCatalogList(list, this.list(kind))) return false;
    (this.held as Record<CatalogListKind, { list: unknown; text: string } | null>)[kind] = { list, text };
    return true;
  }

  /** Asks the service for each list. Resolves true when any list changed; offline or off is fine. */
  async refresh(): Promise<boolean> {
    if (!this.options.online() || !this.options.publicKey) return false;
    let changed = false;
    for (const kind of CATALOG_LIST_KINDS) {
      const text = await this.fetchList(kind);
      if (text !== null && this.accept(kind, text)) changed = true;
    }
    if (changed) await this.save();
    return changed;
  }

  blocked(sha256: string): Block | null {
    return this.list("blocks")?.blocked.find((block) => block.sha256 === sha256) ?? null;
  }

  revoked(fingerprint: string, sha256: string): boolean {
    const revocation = this.list("revocations")?.revoked.find((entry) => entry.fingerprint === fingerprint);
    return revocation !== undefined && !revocation.allow.includes(sha256);
  }

  firstKey(fingerprint: string): string {
    const statements = this.list("successions")?.successions ?? [];
    // A key named as the new key of two different old keys has no clear owner: neither is followed.
    const before = new Map<string, { old: string; account: string } | null>();
    for (const { old, new: next, account } of statements) {
      const known = before.get(next);
      before.set(next, known === undefined || (known?.old === old && known.account === account) ? { old, account } : null);
    }
    let key = fingerprint;
    let account: string | undefined;
    const seen = new Set([key]);
    for (let i = 0; i < MAX_SUCCESSIONS; i++) {
      const step = before.get(key);
      // Every step stays in the one account, and a loop goes nowhere.
      if (!step || (account !== undefined && step.account !== account) || seen.has(step.old)) break;
      account = step.account;
      key = step.old;
      seen.add(key);
    }
    return key;
  }

  private async fetchList(kind: CatalogListKind): Promise<string | null> {
    try {
      const response = await (this.options.fetchImpl ?? fetch)(`${this.baseUrl}/v1/catalog/lists/${kind}.json`, {
        signal: AbortSignal.timeout(this.options.timeoutMs ?? SAFETY_TIMEOUT_MS),
        credentials: "omit",
        referrerPolicy: "no-referrer",
        redirect: "error",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return null;
      const declared = Number(response.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > MAX_CATALOG_LIST_BYTES) return null;
      const bytes = await response.arrayBuffer();
      return bytes.byteLength > MAX_CATALOG_LIST_BYTES ? null : new TextDecoder().decode(bytes);
    } catch {
      return null;
    }
  }

  private async save(): Promise<void> {
    const saved = Object.fromEntries(CATALOG_LIST_KINDS.flatMap((kind) => (this.held[kind] ? [[kind, this.held[kind].text]] : [])));
    await writeFileAtomic(this.options.file, `${JSON.stringify({ version: 1, ...saved }, null, 2)}\n`).catch(() => undefined);
  }
}

/**
 * Takes the modules in the player's modules folder whose zip is blocked out of
 * `modules`, so their panels stop and they do not load, and says why in
 * `problems`. Their folders and data stay; installing a zip that is not
 * blocked brings them back. Answers with the modules it took out, which the
 * installer still counts as installed, so that zip installs as an update.
 */
export function stopBlocked(
  modules: Map<string, InstalledModule>,
  userModulesRoot: string,
  records: OwnerRecords,
  lists: Pick<SafetyCheck, "blocked">,
  problems: ModuleProblem[],
): Map<string, InstalledModule> {
  const stopped = new Map<string, InstalledModule>();
  for (const [id, module] of modules) {
    if (module.provenance !== "local" || path.dirname(module.root) !== userModulesRoot) continue;
    const record = records[path.basename(module.root)];
    const block = record?.id === id && record.sha256 ? lists.blocked(record.sha256) : null;
    if (!block) continue;
    modules.delete(id);
    stopped.set(id, module);
    problems.push({
      folder: path.basename(module.root),
      path: module.root,
      message: `Tavora stopped ${module.manifest.name} ${module.manifest.version} because it can do harm: ${block.reason} Its data is kept, and it comes back when you install a version that is not blocked.`,
    });
  }
  return stopped;
}
