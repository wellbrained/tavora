import { describe, expect, it } from "vitest";
import type { InstalledModule } from "./module-page";
import { pageModule } from "./module-page";

const module = {
  id: "local.tracker",
  name: "Tracker",
  description: "Tracks runs.",
  version: "1.2.0",
  available: true,
  publisher: "abcdef0123456789",
  publisherName: "Sam",
  icon: "data:image/png;base64,AAAA",
  permissions: { asks: { network: ["api.example.com"], connectors: [] }, granted: { network: [], connectors: [] }, missing: { network: [], connectors: [] } },
} as unknown as InstalledModule;

describe("pageModule", () => {
  it("fills the page from the module's manifest and leaves out what only a listing knows", () => {
    expect(pageModule(module)).toMatchObject({
      id: "local.tracker",
      name: "Tracker",
      version: "1.2.0",
      owner: "abcdef0123456789",
      publisher: "Sam",
      permissions: { network: ["api.example.com"], connectors: [] },
      fits: true,
      icon: true,
      size: 0,
      screenshots: 0,
      homepage: null,
      rating: null,
    });
  });

  it("has no publisher line for a module without a key", () => {
    expect(pageModule({ ...module, publisher: null, publisherName: null, icon: null })).toMatchObject({ owner: "", publisher: null, icon: false });
  });
});
