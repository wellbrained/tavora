import { readFileSync } from "node:fs";
import path from "node:path";
import type { Hono } from "hono";
import { PATCH_NOTES } from "../../desktop/src/shared/patch-notes.ts";
import type { AccountStore } from "./account-store.ts";
import { compareVersions, type Probes } from "./admin-probes.ts";
import type { CatalogStore } from "./catalog.ts";
import { PUBLISH_LIMITS } from "./catalog-publish.ts";
import type { IconStore } from "./icons.ts";
import type { ReviewStore } from "./reviews.ts";
import type { Submissions } from "./submissions.ts";

/**
 * The JSON behind the panel's overview, updates, modules, accounts and status pages. All read-only, and
 * all numbers or public facts: nothing here names a player (the account list, which does, is accounts-admin.ts). (The review actions stay in admin-app.ts.)
 */

export interface PanelOptions {
  submissions: Submissions;
  store: IconStore;
  catalog?: CatalogStore | undefined;
  accounts?: AccountStore | undefined;
  reviews?: ReviewStore | undefined;
  probes: Probes;
  /** How many key replacement requests wait for a decision. */
  keysWaiting: () => number;
  /** How many blocks wait to be signed. */
  blocksToSign?: () => number;
  /** The game dataset's name for itself (`/v1/health`): how many games, and when it was built. */
  dataset: () => { games: number; builtAt: string | null };
  /** Emails a day the provider allows; absent while accounts are off. */
  mailDailyLimit?: number | undefined;
  /** Where the daily backup leaves its `last-backup.txt` (the state directory). */
  stateDir?: string | undefined;
  now?: () => number;
}

/** One kind of thing that waits for the maintainer. Add a kind here and the Overview lists it. */
export interface WaitingKind {
  id: string;
  label: string;
  count: number;
  /** The panel section that handles it, and the tab inside it when it has one. */
  section: string;
  tab?: string;
}

export const PACKAGES = ["sdk", "module-schema", "pack", "create-module"] as const;
const SITES = [
  { name: "mytavora.app", url: "https://mytavora.app" },
  { name: "docs.mytavora.app", url: "https://docs.mytavora.app" },
  { name: "updates.mytavora.app", url: "https://updates.mytavora.app/latest.yml" },
] as const;

const day = (at: number) => new Date(at).toISOString().slice(0, 10);

export function registerPanelRoutes(app: Hono, options: PanelOptions): void {
  const { submissions, store, catalog, accounts, reviews, probes, now = Date.now } = options;

  const waiting = (): WaitingKind[] => [
    { id: "approval", label: "Module versions waiting for review", count: catalog?.waitingVersions().length ?? 0, section: "approval" },
    { id: "icons", label: "Icons offered by players", count: submissions.listPending().length, section: "review", tab: "pending" },
    { id: "reports", label: "Reported modules", count: catalog?.reports().length ?? 0, section: "review", tab: "reports" },
    { id: "reviews", label: "Reported reviews", count: reviews?.reports().length ?? 0, section: "review", tab: "reviews" },
    { id: "keys", label: "Publisher key requests", count: options.keysWaiting(), section: "review", tab: "keys" },
    { id: "blocks", label: "Blocks to sign", count: options.blocksToSign?.() ?? 0, section: "modules" },
    { id: "catalog-full", label: "The module catalog is full", count: catalog?.fullSince() ? 1 : 0, section: "status" },
  ];

  app.get("/api/summary", (context) => {
    const modules = catalog?.adminModules() ?? [];
    return context.json({
      waiting: waiting(),
      numbers: {
        hostedIcons: store.list().length,
        modules: modules.length,
        listedModules: modules.filter((module) => module.listed && module.versions.some((version) => version.status === "listed")).length,
        installs: modules.reduce((sum, module) => sum + module.installs, 0),
        accounts: accounts ? accounts.counts(now()).total : null,
        catalogBytes: catalog?.storedBytes() ?? 0,
      },
    });
  });

  app.get("/api/updates", async (context) => {
    const feed = await probes.feed();
    return context.json({
      feed,
      versions: PATCH_NOTES.slice(0, 40).map((note) => ({
        ...note,
        state: !feed ? "unknown" : compareVersions(note.version, feed.version) > 0 ? "waiting" : compareVersions(note.version, feed.version) === 0 ? "on-feed" : "earlier",
      })),
    });
  });

  app.get("/api/modules", (context) => {
    const modules = (catalog?.adminModules() ?? []).map((module) => ({ ...module, publisher: accounts?.publisherName(module.owner) ?? null }));
    return context.json({ modules, storedBytes: catalog?.storedBytes() ?? 0, limitBytes: PUBLISH_LIMITS.catalogBytes, fullSince: catalog?.fullSince() ?? null });
  });

  // A module's icon, listed or not.
  app.get("/api/modules/icons/:file", (context) => {
    const match = /^([0-9a-f]{64})\.(png|webp)$/.exec(context.req.param("file"));
    const bytes = match ? catalog?.iconFile(match[1]!, match[2]!) : null;
    return bytes ? new Response(new Uint8Array(bytes), { headers: { "Content-Type": `image/${match![2]}`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=31536000, immutable" } }) : context.json({ error: "Not found." }, 404);
  });

  app.get("/api/accounts", (context) => (accounts ? context.json({ on: true, ...accounts.counts(now()) }) : context.json({ on: false })));

  app.get("/api/status", async (context) => {
    const [sites, packages] = await Promise.all([
      Promise.all(SITES.map(async (site) => ({ name: site.name, ...(await probes.site(site.url)) }))),
      Promise.all(
        PACKAGES.map(async (name) => {
          const [npm, main] = await Promise.all([probes.npmVersion(`@tavora/${name}`), probes.mainVersion(`packages/${name}`)]);
          return { name: `@tavora/${name}`, npm, main, mainAhead: npm !== null && main !== null && compareVersions(main, npm) > 0 };
        }),
      ),
    ]);
    const today = day(now());
    return context.json({
      api: { ok: true, ...options.dataset() },
      mail: accounts ? { day: today, sent: accounts.mailsSent(today), limit: options.mailDailyLimit ?? null } : null,
      backup: { at: lastBackup(options.stateDir) },
      catalog: { storedBytes: catalog?.storedBytes() ?? 0, limitBytes: PUBLISH_LIMITS.catalogBytes, fullSince: catalog?.fullSince() ?? null },
      sites,
      packages,
    });
  });
}

/** When the daily backup last finished: the time its script wrote into `last-backup.txt`, or null if nothing says. */
function lastBackup(stateDir: string | undefined): string | null {
  if (!stateDir) return null;
  try {
    const text = readFileSync(path.join(stateDir, "last-backup.txt"), "utf8").trim();
    return Number.isNaN(Date.parse(text)) ? null : new Date(text).toISOString();
  } catch {
    return null;
  }
}
