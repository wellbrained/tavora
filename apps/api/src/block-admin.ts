import type { Block } from "@tavora/pack";
import { Hono } from "hono";
import type { CatalogStore } from "./catalog.ts";
import type { CatalogTrust } from "./catalog-trust.ts";

/**
 * Block from the panel (decided 2026-10-26): the maintainer picks a zip and writes why, the panel keeps it as a block
 * to sign, and offers every block in force plus the ones to sign as a file for `pnpm tavora-catalog-sign blocks`. The
 * catalogue key never comes to the server: the maintainer signs on their PC and uploads with `tavora-api-catalog
 * set-list blocks`. A block counts as in force once the served signed list holds it; then users' Tavora turns that
 * zip off and keeps its data. Taking a block back out of force means signing a list without it.
 *
 * A block of a zip names two hashes when the catalog knows both (S7): the zip's own SHA-256, which older apps match, and
 * the SHA-256 of what its signature covers (signed_sha256), which stays the same when the same signed files are packed
 * again. Each is a plain `{ sha256, reason }` entry, so the list's format doesn't change. The panel shows one row per
 * zip, and a block in force that lacks one of its hashes is offered to sign again, so the next list adds it.
 */

const STAGED = "staged_blocks";
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_REASON = 300;

interface Staged extends Block {
  stagedAt: string;
  /** The zip's signed hash when it was staged (added for S7, absent before), so the block keeps it if the row goes. */
  signedSha256?: string;
}

/** An entry the next signed list adds: `zip` is the blocked zip it is for, `stagedAt` null for a block already in force. */
export interface BlockToSign extends Block {
  zip: string;
  stagedAt: string | null;
}

const staged = (catalog: CatalogStore): Staged[] => JSON.parse(catalog.getState(STAGED) ?? "[]") as Staged[];
const inForce = (trust: CatalogTrust | null): Block[] => trust?.signed("blocks")?.blocked ?? [];

/**
 * The zip a hash is for, and every hash a block of it names: the zip's own, then its signed hash when known (from the
 * catalog, else from the staged block, for a version whose row was deleted since, as a declined one is).
 */
function zipOf(catalog: CatalogStore, sha256: string, stagedSigned?: string) {
  const version = catalog.versionBySha(sha256);
  const zip = version?.sha256 ?? sha256;
  const signed = version?.signedSha256 ?? (typeof stagedSigned === "string" && SHA256.test(stagedSigned) ? stagedSigned : null);
  const hashes = signed && signed !== zip ? [zip, signed] : [zip];
  return { zip, hashes, signed, version };
}

/**
 * The entries waiting to be signed: first the hashes missing from blocks already in force (a zip blocked by one of its
 * hashes gets the other), then both hashes of every staged block, leaving out what the served list holds already.
 */
export function blocksToSign(catalog: CatalogStore, trust: CatalogTrust | null): BlockToSign[] {
  const blocked = inForce(trust);
  const listed = new Set(blocked.map((block) => block.sha256));
  const entries: BlockToSign[] = [];
  const add = (block: Block, stagedAt: string | null, stagedSigned?: string) => {
    const { zip, hashes } = zipOf(catalog, block.sha256, stagedSigned);
    for (const sha256 of hashes) {
      if (listed.has(sha256)) continue;
      listed.add(sha256);
      entries.push({ sha256, reason: block.reason, zip, stagedAt });
    }
  };
  for (const block of blocked) add(block, null);
  for (const block of staged(catalog)) add(block, block.stagedAt, block.signedSha256);
  return entries;
}

/** How many zips have something to sign, for the summary. */
export const zipsToSign = (catalog: CatalogStore, trust: CatalogTrust | null): number => new Set(blocksToSign(catalog, trust).map((entry) => entry.zip)).size;

/** The same rule as the signed list: one line of plain text, no control or direction characters. */
const isReason = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= MAX_REASON && !/[\p{Cc}‎‏‪-‮⁦-⁩]/u.test(value);

interface BlockRow {
  /** The zip's own hash. */
  sha256: string;
  signedSha256: string | null;
  reason: string;
  id: string | null;
  name: string | null;
  version: string | null;
  state: "in-force" | "to-sign";
  /** The hashes of this zip the next signed list adds. */
  toSign: string[];
}

export function blockRoutes({ catalog, trust }: { catalog: CatalogStore; trust: () => CatalogTrust | null }) {
  const app = new Hono();
  const json = async (request: Request): Promise<Record<string, unknown>> => {
    try {
      const body = JSON.parse(await request.text()) as unknown;
      return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };
  const save = (blocks: Staged[]) => catalog.setState(STAGED, JSON.stringify(blocks));

  // One row per blocked zip: in force when the served list names either of its hashes, else to sign.
  app.get("/", (context) => {
    const lists = trust();
    const signed = lists?.signed("blocks") ?? null;
    const served = new Set(inForce(lists).map((block) => block.sha256));
    const rows = new Map<string, BlockRow>();
    const describe = (block: Block, stagedSigned?: string) => {
      const { zip, hashes, signed: signedSha256, version } = zipOf(catalog, block.sha256, stagedSigned);
      if (rows.has(zip)) return;
      rows.set(zip, {
        sha256: zip,
        signedSha256,
        reason: block.reason,
        id: version?.id ?? null,
        name: version?.name ?? null,
        version: version?.version ?? null,
        state: hashes.some((hash) => served.has(hash)) ? "in-force" : "to-sign",
        toSign: hashes.filter((hash) => !served.has(hash)),
      });
    };
    for (const block of inForce(lists)) describe(block);
    for (const block of staged(catalog)) describe(block, block.signedSha256);
    return context.json({ blocks: [...rows.values()], signed: signed ? { sequence: signed.sequence, issued: signed.issued } : null });
  });

  // As a file for `pnpm tavora-catalog-sign blocks <file> --key … --out …`: every block in force as served, then the
  // entries to sign. Each is { sha256, reason }, the list's format as before.
  app.get("/blocks.json", () => {
    const lists = trust();
    const entries: Block[] = [...inForce(lists), ...blocksToSign(catalog, lists).map(({ sha256, reason }) => ({ sha256, reason }))];
    return new Response(`${JSON.stringify(entries, null, 2)}\n`, { headers: { "Content-Type": "application/json; charset=utf-8" } });
  });

  // `sha256` may be the zip's hash or its signed hash; the block is kept under the zip's, and both go into the list.
  app.post("/", async (context) => {
    const { sha256, reason } = await json(context.req.raw);
    if (typeof sha256 !== "string" || !SHA256.test(sha256) || !isReason(reason)) {
      return context.json({ error: `Send { sha256, reason } with a reason of one line, at most ${MAX_REASON} characters.` }, 400);
    }
    const { zip, hashes, version } = zipOf(catalog, sha256);
    if (!version) return context.json({ error: "The catalog never had this zip." }, 404);
    // In force by either hash: a hash it still lacks is offered to sign already (blocksToSign).
    if (inForce(trust()).some((block) => hashes.includes(block.sha256))) return context.json({ error: "This zip is blocked already." }, 409);
    const block: Staged = { sha256: zip, reason: reason.trim(), stagedAt: new Date().toISOString(), ...(version.signedSha256 ? { signedSha256: version.signedSha256 } : {}) };
    save([...staged(catalog).filter((other) => zipOf(catalog, other.sha256).zip !== zip), block]);
    return context.json({ ok: true });
  });

  app.post("/remove", async (context) => {
    const { sha256 } = await json(context.req.raw);
    if (typeof sha256 !== "string") return context.json({ error: "Send { sha256 }." }, 400);
    const { zip, hashes } = zipOf(catalog, sha256);
    if (inForce(trust()).some((block) => hashes.includes(block.sha256))) return context.json({ error: "This block is in force. Sign a list without it to take it back." }, 409);
    const before = staged(catalog);
    const after = before.filter((block) => zipOf(catalog, block.sha256).zip !== zip);
    if (after.length === before.length) return context.json({ error: "No such block to sign." }, 404);
    save(after);
    return context.json({ ok: true });
  });

  return app;
}
