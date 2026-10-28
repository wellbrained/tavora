import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { AccountStore } from "../src/account-store.ts";
import { ActivityLog } from "../src/activity-log.ts";
import { CatalogStore } from "../src/catalog.ts";
import { ConversationStore } from "../src/conversations.ts";
import { ReviewStore } from "../src/reviews.ts";
import { StatsStore } from "../src/stats.ts";
import { seedDev } from "./seed-dev.ts";

// The seed fills every store the server opens. When a store changes, this fails here instead of in somebody's local Tavora Admin.
describe("the development seed", () => {
  it("fills a state folder the stores open with the expected data", { timeout: 120_000 }, () => {
    const dir = mkdtempSync(path.join(tmpdir(), "tavora-seed-"));
    const now = Date.parse("2026-10-28T12:00:00Z");
    const summary = seedDev({ stateDir: path.join(dir, "state"), gamesFile: path.join(dir, "games.sqlite"), now });
    expect(summary).toMatchObject({ games: 30, accounts: 25, developers: 5, suspended: 1, banned: 1, modules: 9, waitingVersions: 2, unlistedModules: 2, openModuleReports: 3, keyRequests: 1, tavoraConversations: 4, reportedConversations: 1, iconOffers: 5 });
    expect(summary.reviews).toBeGreaterThanOrEqual(75);
    expect(summary.activityEntries).toBeGreaterThanOrEqual(35);

    const state = path.join(dir, "state");
    const accounts = new AccountStore(path.join(state, "accounts.sqlite"));
    expect(accounts.accountRows()).toHaveLength(25);
    expect(accounts.accountRows().filter((row) => row.developerName === "Kai Brenner" || row.developerName === "Lena Hartmann" || row.developerName === "Wellbrained" || row.developerName === "Clickworks")).toHaveLength(4);
    const catalog = new CatalogStore(path.join(state, "catalog"));
    expect(catalog.adminModules().map((module) => module.id)).toContain("kai.map-pins");
    expect(catalog.waitingVersions().map((waiting) => waiting.id).sort()).toEqual(["clickworks.macro-pad", "kai.loot-tracker"]);
    expect(catalog.index().length).toBe(6);
    const reviews = new ReviewStore(path.join(state, "reviews.sqlite"));
    expect(reviews.queue().length).toBeGreaterThan(5);
    expect(reviews.reports()).toHaveLength(3);
    const conversations = new ConversationStore(path.join(state, "conversations.sqlite"));
    expect(conversations.reportedConversations()).toHaveLength(1);
    expect(Object.keys(conversations.texts()).length).toBeGreaterThan(0);
    const stats = new StatsStore(path.join(state, "stats.sqlite"));
    const series = stats.series("2025-10-29", "2026-10-28");
    expect(series.days).toHaveLength(365);
    expect(Object.keys(series.totals["module-install"]).length).toBeGreaterThanOrEqual(6);
    expect(series.accounts.at(-1)?.total).toBe(25);
    expect(new ActivityLog(path.join(state, "activity.sqlite")).list({ limit: 200 }).entries.length).toBe(summary.activityEntries);
    const games = new DatabaseSync(path.join(dir, "games.sqlite"), { readOnly: true });
    expect((games.prepare("select count(*) as n from games").get() as { n: number }).n).toBe(30);
  });
});
