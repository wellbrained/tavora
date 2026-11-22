import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { publishReadMs, ZIP_LIMITS } from "@tavora/pack";
import { describe, expect, it, vi } from "vitest";
import { CatalogStore } from "./catalog.ts";
import { backfillAtStart, HEADERS_TIMEOUT_MS, setServerTimeouts } from "./server-start.ts";

const source = () => readFileSync(new URL("./server.ts", import.meta.url), "utf8");

describe("starting the server", () => {
  it("goes on when the backfill can't write to the catalog, and says so", () => {
    const catalog = new CatalogStore(mkdtempSync(path.join(tmpdir(), "tavora-start-")));
    catalog.setState("signed_backfill_reading", "a".repeat(64));
    catalog.setState = () => {
      throw new Error("attempt to write a readonly database");
    };
    const log = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    expect(() => backfillAtStart(catalog, log)).not.toThrow();
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining("readonly database"));
    catalog.close();
  });

  it("runs the backfill through that guard", () => {
    expect(source()).toContain("backfillAtStart(catalog)");
    expect(source()).not.toContain("catalog.backfillSignedHashes");
  });

  it("gives a request longer than the slowest upload the catalog allows, and headers only their minute", () => {
    const server = createServer();
    setServerTimeouts(server);
    expect(server.requestTimeout).toBeGreaterThan(publishReadMs(ZIP_LIMITS.maxArchiveBytes));
    expect(server.requestTimeout).toBeGreaterThanOrEqual(600_000);
    expect(server.headersTimeout).toBe(HEADERS_TIMEOUT_MS);
    expect(server.headersTimeout).toBeLessThan(server.requestTimeout);
  });

  it("sets those timeouts on the public server", () => {
    expect(source()).toMatch(/setServerTimeouts\(publicServer/);
  });
});
