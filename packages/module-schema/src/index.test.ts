import { glob, readFile } from "node:fs/promises";
import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";
import schema from "../schema/tavora.module.schema.json" with { type: "json" };
import { isGameId, isModuleId, isOwnerId, validateManifest } from "./index";

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

  it("accepts exact public hosts as network permissions", () => {
    const manifest = { ...valid, permissions: { network: ["api.example.com", "cdn.discordapp.com", "xn--mller-kva.de"] } };
    expect(validateManifest(manifest)).toEqual({ ok: true, manifest });
  });

  it("names the hosts it refuses", () => {
    expect(validateManifest({ ...valid, permissions: { network: ["https://api.example.com", "*.example.com"] } })).toEqual({
      ok: false,
      errors: ["permissions.network must list exact public host names such as api.example.com (lowercase, no scheme, port or wildcard): https://api.example.com, *.example.com"],
    });
    expect(validateManifest({ ...valid, permissions: { network: ["a.example", "a.example"] } })).toEqual({ ok: false, errors: ["permissions.network lists a host twice"] });
  });

  it("accepts the WebAssembly permission as a true or false, and nothing else in its place", () => {
    expect(validateManifest({ ...valid, permissions: { network: [], webAssembly: true } }).ok).toBe(true);
    expect(validateManifest({ ...valid, permissions: { network: [], webAssembly: false } }).ok).toBe(true);
    expect(validateManifest({ ...valid, permissions: { network: [], webAssembly: "yes" } })).toEqual({ ok: false, errors: ["permissions.webAssembly must be true or false"] });
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

  it("accepts the optional $schema, description and icon fields", () => {
    const full = {
      ...valid,
      $schema: "./node_modules/@tavora/module-schema/schema/tavora.module.schema.json",
      description: "Tracks campaign progress.",
      icon: "assets/icon.png",
    };
    expect(validateManifest(full)).toEqual({ ok: true, manifest: full });
  });

  it("rejects unknown viewport fields", () => {
    expect(validateManifest({ ...valid, viewport: { minWidth: 320, minHeight: 240, maxWidth: 9 } })).toEqual({
      ok: false,
      errors: ["unknown viewport fields: maxWidth"],
    });
  });
});

// Every case is checked by the validator and by the JSON Schema, and both
// must agree, so editors flag exactly what Tavora refuses to load.
const cases: [string, unknown, boolean][] = [
  ["minimal", valid, true],
  ["full", { ...valid, $schema: "x", description: "Plans builds.", icon: "assets/icon.webp" }, true],
  ["any game", { ...valid, games: [] }, true],
  ["prerelease version", { ...valid, version: "2.0.0-beta.1" }, true],
  ["nested entry", { ...valid, entry: "a/b/c/index.html" }, true],
  ["dotted file name", { ...valid, entry: "dist/.index.html" }, true],
  ["missing id", { ...valid, id: undefined }, false],
  ["one-part id", { ...valid, id: "notes" }, false],
  ["uppercase id", { ...valid, id: "Community.example" }, false],
  ["long id", { ...valid, id: `a.${"b".repeat(127)}` }, false],
  ["blank name", { ...valid, name: "   " }, false],
  ["long name", { ...valid, name: "n".repeat(81) }, false],
  ["blank description", { ...valid, description: "" }, false],
  ["long description", { ...valid, description: "d".repeat(301) }, false],
  ["numeric $schema", { ...valid, $schema: 1 }, false],
  ["two-part version", { ...valid, version: "1.0" }, false],
  ["leading zero version", { ...valid, version: "01.0.0" }, false],
  ["api version 2", { ...valid, apiVersion: "2" }, false],
  ["numeric api version", { ...valid, apiVersion: 1 }, false],
  ["entry with ..", { ...valid, entry: "dist/../index.html" }, false],
  ["entry with .", { ...valid, entry: "./index.html" }, false],
  ["absolute entry", { ...valid, entry: "/index.html" }, false],
  ["entry with backslash", { ...valid, entry: "dist\\index.html" }, false],
  ["entry with scheme", { ...valid, entry: "https://x.example/index.html" }, false],
  ["entry with empty segment", { ...valid, entry: "dist//index.html" }, false],
  ["entry with null byte", { ...valid, entry: "dist/\u0000.html" }, false],
  ["script entry", { ...valid, entry: "dist/index.js" }, false],
  ["svg icon", { ...valid, icon: "icon.svg" }, false],
  ["icon outside package", { ...valid, icon: "../icon.png" }, false],
  ["remote icon", { ...valid, icon: "https://x.example/icon.png" }, false],
  ["games not an array", { ...valid, games: "poe2" }, false],
  ["bad game id", { ...valid, games: ["Poe 2"] }, false],
  ["missing viewport", { ...valid, viewport: undefined }, false],
  ["zero width", { ...valid, viewport: { minWidth: 0, minHeight: 240 } }, false],
  ["fractional width", { ...valid, viewport: { minWidth: 1.5, minHeight: 240 } }, false],
  ["huge height", { ...valid, viewport: { minWidth: 320, minHeight: 10_001 } }, false],
  ["bad preferred size", { ...valid, viewport: { minWidth: 320, minHeight: 240, preferredHeight: -1 } }, false],
  ["unknown viewport field", { ...valid, viewport: { minWidth: 320, minHeight: 240, x: 1 } }, false],
  ["missing permissions", { ...valid, permissions: undefined }, false],
  ["network host", { ...valid, permissions: { network: ["api.example.com"] } }, true],
  ["32 network hosts", { ...valid, permissions: { network: Array.from({ length: 32 }, (_, i) => `h${i}.example.com`) } }, true],
  ["33 network hosts", { ...valid, permissions: { network: Array.from({ length: 33 }, (_, i) => `h${i}.example.com`) } }, false],
  ["host twice", { ...valid, permissions: { network: ["api.example.com", "api.example.com"] } }, false],
  ["host with scheme", { ...valid, permissions: { network: ["https://api.example.com"] } }, false],
  ["host with port", { ...valid, permissions: { network: ["api.example.com:443"] } }, false],
  ["host with path", { ...valid, permissions: { network: ["api.example.com/v1"] } }, false],
  ["wildcard host", { ...valid, permissions: { network: ["*.example.com"] } }, false],
  ["uppercase host", { ...valid, permissions: { network: ["API.example.com"] } }, false],
  ["single-label host", { ...valid, permissions: { network: ["intranet"] } }, false],
  ["trailing dot host", { ...valid, permissions: { network: ["api.example.com."] } }, false],
  ["ipv4 host", { ...valid, permissions: { network: ["93.184.216.34"] } }, false],
  ["ipv6 host", { ...valid, permissions: { network: ["[::1]"] } }, false],
  ["localhost", { ...valid, permissions: { network: ["localhost"] } }, false],
  ["dev.localhost", { ...valid, permissions: { network: ["dev.localhost"] } }, false],
  [".local host", { ...valid, permissions: { network: ["printer.local"] } }, false],
  ["hyphen-edged label", { ...valid, permissions: { network: ["-api.example.com"] } }, false],
  ["long label", { ...valid, permissions: { network: [`${"a".repeat(64)}.example.com`] } }, false],
  ["unicode host", { ...valid, permissions: { network: ["müller.de"] } }, false],
  ["non-string host", { ...valid, permissions: { network: [7] } }, false],
  ["shared data permission", { ...valid, permissions: { network: [], sharedData: { consume: [] } } }, false],
  ["unknown field", { ...valid, nodeIntegration: true }, false],
];

describe("JSON Schema", () => {
  const ajv = new Ajv({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);

  it.each(cases)("agrees with the validator: %s", (_name, manifest, expected) => {
    // Drop undefined fields the way JSON.parse would never produce them.
    const input = JSON.parse(JSON.stringify(manifest)) as unknown;
    expect(validateManifest(input).ok).toBe(expected);
    expect(validate(input)).toBe(expected);
  });

  it("validates every example and fixture manifest in the repo", async () => {
    const root = new URL("../../../", import.meta.url);
    let checked = 0;
    for await (const file of glob(["examples/*/tavora.module.json", "apps/desktop/test/fixtures/*/tavora.module.json"], {
      cwd: root,
    })) {
      checked++;
      const manifest = JSON.parse(await readFile(new URL(file, root), "utf8")) as unknown;
      expect(validateManifest(manifest), file).toMatchObject({ ok: true });
      expect(validate(manifest), file).toBe(true);
    }
    expect(checked).toBeGreaterThanOrEqual(4);
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

describe("isOwnerId", () => {
  it("accepts official, local and a key fingerprint", () => {
    expect(isOwnerId("official")).toBe(true);
    expect(isOwnerId("local")).toBe(true);
    expect(isOwnerId("0123456789abcdef0123456789abcdef")).toBe(true);
  });

  it.each(["", "Local", "tavora.notes", "0123456789ABCDEF0123456789ABCDEF", "0123456789abcdef", "../x", 7])("refuses %j", (value) => {
    expect(isOwnerId(value)).toBe(false);
  });
});
