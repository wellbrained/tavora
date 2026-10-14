import { describe, expect, it } from "vitest";
import { isGameId, isModuleId, validateManifest } from "./index";

const valid = {
  id: "community.example.campaign-companion",
  name: "Campaign Companion",
  version: "1.0.0",
  apiVersion: "1",
  entry: "dist/index.html",
  games: ["poe2"],
  viewport: { minWidth: 320, minHeight: 240, preferredWidth: 720 },
  permissions: { network: [] },
};

describe("validateManifest", () => {
  it("accepts a valid manifest", () => {
    expect(validateManifest(valid)).toEqual({ ok: true, manifest: valid });
  });

  it.each([
    ["../escape.html"],
    ["dist/../../x.html"],
    ["/abs/index.html"],
    ["dist\\index.html"],
    ["https://evil.example/index.html"],
    ["dist//index.html"],
    ["./index.html"],
    ["dist/index.js"],
  ])("rejects unsafe entry %s", (entry) => {
    expect(validateManifest({ ...valid, entry }).ok).toBe(false);
  });

  it("rejects network permissions until mediation exists", () => {
    const result = validateManifest({ ...valid, permissions: { network: ["api.example.com"] } });
    expect(result).toEqual({ ok: false, errors: ["permissions.network is not supported yet and must be empty"] });
  });

  it("rejects unknown fields and permissions instead of ignoring them", () => {
    expect(validateManifest({ ...valid, nodeIntegration: true }).ok).toBe(false);
    expect(validateManifest({ ...valid, permissions: { network: [], filesystem: ["/"] } }).ok).toBe(false);
  });

  it("rejects bad viewport sizes", () => {
    expect(validateManifest({ ...valid, viewport: { minWidth: 0, minHeight: 240 } }).ok).toBe(false);
    expect(validateManifest({ ...valid, viewport: { minWidth: 1.5, minHeight: 240 } }).ok).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(validateManifest(null).ok).toBe(false);
    expect(validateManifest([]).ok).toBe(false);
  });
});

describe("ids", () => {
  it.each(["local.example.vanilla-module", "tavora.notes", "community.someone.poe2-tracker"])(
    "accepts module id %s",
    (id) => expect(isModuleId(id)).toBe(true),
  );

  it.each(["notes", "Tavora.notes", "a..b", "a.b/../c", "a.b@c", "a.b c", "a.-b", ""])(
    "rejects module id %s",
    (id) => expect(isModuleId(id)).toBe(false),
  );

  it.each(["poe2", "satisfactory", "elden-ring"])("accepts game id %s", (id) => expect(isGameId(id)).toBe(true));

  it.each(["", "../poe2", "PoE2", "poe 2", "-x", "a".repeat(65)])("rejects game id %s", (id) =>
    expect(isGameId(id)).toBe(false),
  );
});
