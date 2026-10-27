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
 */

const STAGED = "staged_blocks";
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_REASON = 300;

interface Staged extends Block {
  stagedAt: string;
}

const staged = (catalog: CatalogStore): Staged[] => JSON.parse(catalog.getState(STAGED) ?? "[]") as Staged[];
const inForce = (trust: CatalogTrust | null): Block[] => trust?.signed("blocks")?.blocked ?? [];

/** The blocks waiting to be signed: staged, and not in the served list yet. */
export function blocksToSign(catalog: CatalogStore, trust: CatalogTrust | null): Staged[] {
  const signed = new Set(inForce(trust).map((block) => block.sha256));
  return staged(catalog).filter((block) => !signed.has(block.sha256));
}

/** The same rule as the signed list: one line of plain text, no control or direction characters. */
const isReason = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= MAX_REASON && !/[\p{Cc}‎‏‪-‮⁦-⁩]/u.test(value);

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

  app.get("/", (context) => {
    const lists = trust();
    const signed = lists?.signed("blocks") ?? null;
    const describe = (block: Block, state: "in-force" | "to-sign") => {
      const version = catalog.versionBySha(block.sha256);
      return { sha256: block.sha256, reason: block.reason, id: version?.id ?? null, name: version?.name ?? null, version: version?.version ?? null, state };
    };
    return context.json({
      blocks: [...inForce(lists).map((block) => describe(block, "in-force")), ...blocksToSign(catalog, lists).map((block) => describe(block, "to-sign"))],
      signed: signed ? { sequence: signed.sequence, issued: signed.issued } : null,
    });
  });

  // As a file for `pnpm tavora-catalog-sign blocks <file> --key … --out …`: every block in force, then the ones to sign.
  app.get("/blocks.json", () => {
    const lists = trust();
    const entries: Block[] = [...inForce(lists), ...blocksToSign(catalog, lists).map(({ sha256, reason }) => ({ sha256, reason }))];
    return new Response(`${JSON.stringify(entries, null, 2)}\n`, { headers: { "Content-Type": "application/json; charset=utf-8" } });
  });

  app.post("/", async (context) => {
    const { sha256, reason } = await json(context.req.raw);
    if (typeof sha256 !== "string" || !SHA256.test(sha256) || !isReason(reason)) {
      return context.json({ error: `Send { sha256, reason } with a reason of one line, at most ${MAX_REASON} characters.` }, 400);
    }
    if (!catalog.versionBySha(sha256)) return context.json({ error: "The catalog never had this zip." }, 404);
    if (inForce(trust()).some((block) => block.sha256 === sha256)) return context.json({ error: "This zip is blocked already." }, 409);
    save([...staged(catalog).filter((block) => block.sha256 !== sha256), { sha256, reason: reason.trim(), stagedAt: new Date().toISOString() }]);
    return context.json({ ok: true });
  });

  app.post("/remove", async (context) => {
    const { sha256 } = await json(context.req.raw);
    if (typeof sha256 !== "string") return context.json({ error: "Send { sha256 }." }, 400);
    if (inForce(trust()).some((block) => block.sha256 === sha256)) return context.json({ error: "This block is in force. Sign a list without it to take it back." }, 409);
    const before = staged(catalog);
    const after = before.filter((block) => block.sha256 !== sha256);
    if (after.length === before.length) return context.json({ error: "No such block to sign." }, 404);
    save(after);
    return context.json({ ok: true });
  });

  return app;
}
