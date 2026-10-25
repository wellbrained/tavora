import { glob, readFile } from "node:fs/promises";
import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";
import schema from "../schema/tavora.module.schema.json" with { type: "json" };
import { CHANGELOG_LIMITS, connectorsAtAdd, continuingPanelType, manifestFiles, validateChangelog, isGameId, isModuleId, isOwnerId, LAST_TAVORA_WITHOUT_GAME_OVERLAYS, LAST_TAVORA_WITHOUT_TRANSLATIONS, needsNewerTavora, panelTypes, translateManifest, validateManifest, type ModuleManifest } from "./index";

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
  it("takes workspaces only as a boolean, and true only for a module for any game", () => {
    const anyGame = { ...valid, games: [] };
    expect(validateManifest({ ...anyGame, workspaces: false }).ok).toBe(true);
    expect(validateManifest({ ...anyGame, workspaces: true }).ok).toBe(true);
    expect(validateManifest({ ...valid, workspaces: false }).ok).toBe(true);
    expect(validateManifest({ ...anyGame, workspaces: "yes" })).toEqual({ ok: false, errors: ["workspaces must be true or false"] });
    expect(validateManifest({ ...valid, workspaces: true })).toEqual({ ok: false, errors: ["workspaces can only be true for a module made for any game (games is empty)"] });
  });

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
  ["translations", { ...valid, minTavora: "0.21.0", panels: [{ id: "planner", name: "Planner" }], translations: { de: { name: "Begleiter", description: "Plant Builds.", panels: { planner: "Planer" } }, "pt-br": {} } }, true],
  ["translations with an upper-case code", { ...valid, minTavora: "0.21.0", translations: { DE: { name: "Begleiter" } } }, false],
  ["translations empty", { ...valid, minTavora: "0.21.0", translations: {} }, false],
  ["translation with an unknown field", { ...valid, minTavora: "0.21.0", translations: { de: { readme: "LIESMICH.md" } } }, false],
  ["translated panel name too long", { ...valid, minTavora: "0.21.0", panels: [{ id: "planner", name: "Planner" }], translations: { de: { panels: { planner: "x".repeat(25) } } } }, false],
  ["translated action name on two lines", { ...valid, minTavora: "0.21.0", actions: [{ id: "reset", name: "Reset" }], translations: { de: { actions: { reset: "Zurück\nsetzen" } } } }, false],
  ["full", { ...valid, $schema: "x", description: "Plans builds.", icon: "assets/icon.webp" }, true],
  ["any game", { ...valid, games: [] }, true],
  ["changelog", { ...valid, changelog: "changelog.json" }, true],
  ["changelog not json", { ...valid, changelog: "CHANGELOG.md" }, false],
  ["changelog outside the package", { ...valid, changelog: "../changelog.json" }, false],
  ["homepage", { ...valid, homepage: "https://example.com/my-module?tab=1#top" }, true],
  ["http homepage", { ...valid, homepage: "http://example.com" }, true],
  ["javascript homepage", { ...valid, homepage: "javascript:alert(1)" }, false],
  ["file homepage", { ...valid, homepage: "file:///C:/x" }, false],
  ["homepage with a sign-in", { ...valid, homepage: "https://user:pass@example.com/" }, false],
  ["homepage with a space", { ...valid, homepage: "https://example.com/a b" }, false],
  ["long homepage", { ...valid, homepage: `https://example.com/${"a".repeat(300)}` }, false],
  ["https support", { ...valid, support: "https://example.com/feedback?tab=1" }, true],
  ["email support", { ...valid, support: "feedback@example.com" }, true],
  ["email support with a plus", { ...valid, support: "dev.name+tavora@mail.example.org" }, true],
  ["http support", { ...valid, support: "http://example.com/feedback" }, false],
  ["javascript support", { ...valid, support: "javascript:alert(1)" }, false],
  ["data support", { ...valid, support: "data:text/html,hi" }, false],
  ["mailto support", { ...valid, support: "mailto:feedback@example.com" }, false],
  ["support with a sign-in", { ...valid, support: "https://user:pass@example.com/" }, false],
  ["support with a space", { ...valid, support: "https://example.com/a b" }, false],
  ["email with a query", { ...valid, support: "a?cc=x@example.com" }, false],
  ["email with an encoded query", { ...valid, support: "a%3Fcc=x@example.com" }, false],
  ["email with a line break", { ...valid, support: "a@example.com\nbcc=x@example.com" }, false],
  ["email without a dot", { ...valid, support: "a@localhost" }, false],
  ["junk support", { ...valid, support: "call me" }, false],
  ["empty support", { ...valid, support: "" }, false],
  ["long support", { ...valid, support: `https://example.com/${"a".repeat(300)}` }, false],
  ["readme", { ...valid, readme: "README.md" }, true],
  ["text readme", { ...valid, readme: "docs/about.txt" }, true],
  ["html readme", { ...valid, readme: "README.html" }, false],
  ["readme outside the package", { ...valid, readme: "../README.md" }, false],
  ["screenshots", { ...valid, screenshots: ["assets/one.png", "assets/two.webp"] }, true],
  ["no screenshots", { ...valid, screenshots: [] }, false],
  ["six screenshots", { ...valid, screenshots: ["1", "2", "3", "4", "5", "6"].map((n) => `${n}.png`) }, false],
  ["screenshot twice", { ...valid, screenshots: ["a.png", "a.png"] }, false],
  ["svg screenshot", { ...valid, screenshots: ["a.svg"] }, false],
  ["screenshot outside the package", { ...valid, screenshots: ["../a.png"] }, false],
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
  ["ai-usage connector", { ...valid, permissions: { network: [], connectors: ["ai-usage"] } }, true],
  ["no connectors", { ...valid, permissions: { network: [], connectors: [] } }, true],
  ["discord connector", { ...valid, permissions: { network: [], connectors: ["discord", "ai-usage"] } }, true],
  ["unknown connector", { ...valid, permissions: { network: [], connectors: ["steam"] } }, false],
  ["connector twice", { ...valid, permissions: { network: [], connectors: ["ai-usage", "ai-usage"] } }, false],
  ["connectors not a list", { ...valid, permissions: { network: [], connectors: "ai-usage" } }, false],
  ["shared data permission", { ...valid, permissions: { network: [], sharedData: { consume: [] } } }, false],
  ["unknown field", { ...valid, nodeIntegration: true }, false],
  ["minTavora", { ...valid, minTavora: "0.18.0" }, true],
  ["minTavora with a pre-release", { ...valid, minTavora: "0.18.0-beta" }, false],
  ["minTavora with two parts", { ...valid, minTavora: "0.18" }, false],
  ["minTavora with a leading zero", { ...valid, minTavora: "0.018.0" }, false],
  ["minTavora as a number", { ...valid, minTavora: 18 }, false],
  ["one panel type", { ...valid, panels: [{ id: "planner", name: "Build planner" }] }, true],
  [
    "full panel type",
    { ...valid, panels: [{ id: "map-tracker", name: "Map tracker", entry: "dist/map.html", icon: "map.webp", viewport: { minWidth: 200, minHeight: 100 }, continues: true }] },
    true,
  ],
  ["16 panel types", { ...valid, panels: Array.from({ length: 16 }, (_, i) => ({ id: `p${i}`, name: `Panel ${i}` })) }, true],
  ["17 panel types", { ...valid, panels: Array.from({ length: 17 }, (_, i) => ({ id: `p${i}`, name: `Panel ${i}` })) }, false],
  ["no panel types", { ...valid, panels: [] }, false],
  ["overlay with its connector", { ...valid, overlay: "dist/overlay.html", permissions: { network: [], connectors: ["stream-overlay"] } }, true],
  ["overlay asked for on request", { ...valid, overlay: "dist/overlay.html", permissions: { network: [], connectors: ["stream-overlay"], onRequest: ["stream-overlay"] } }, true],
  ["on request: a connector that can't be", { ...valid, permissions: { network: [], connectors: ["discord"], onRequest: ["discord"] } }, false],
  ["on request: not a list", { ...valid, overlay: "dist/overlay.html", permissions: { network: [], connectors: ["stream-overlay"], onRequest: "stream-overlay" } }, false],
  ["overlay without its connector, for game overlays", { ...valid, minTavora: "0.20.51", overlay: "dist/overlay.html" }, true],
  ["overlay without its connector, from Tavora itself", { ...valid, id: "tavora.clock-counter", overlay: "dist/overlay.html" }, true],
  ["overlay with its connector needs no minTavora", { ...valid, overlay: "dist/overlay.html", permissions: { network: [], connectors: ["stream-overlay"] } }, true],
  ["overlay connector without a page", { ...valid, permissions: { network: [], connectors: ["stream-overlay"] } }, false],
  ["overlay not html", { ...valid, overlay: "dist/overlay.js", permissions: { network: [], connectors: ["stream-overlay"] } }, false],
  ["overlay outside the package", { ...valid, overlay: "../overlay.html", permissions: { network: [], connectors: ["stream-overlay"] } }, false],
  ["actions", { ...valid, actions: [{ id: "start-pause", name: "Start/Pause" }, { id: "reset", name: "Reset" }] }, true],
  ["16 actions", { ...valid, actions: Array.from({ length: 16 }, (_, i) => ({ id: `a${i}`, name: `Action ${i}` })) }, true],
  ["17 actions", { ...valid, actions: Array.from({ length: 17 }, (_, i) => ({ id: `a${i}`, name: `Action ${i}` })) }, false],
  ["no actions", { ...valid, actions: [] }, false],
  ["action id uppercase", { ...valid, actions: [{ id: "Reset", name: "Reset" }] }, false],
  ["action name empty", { ...valid, actions: [{ id: "reset", name: " " }] }, false],
  ["action name too long", { ...valid, actions: [{ id: "reset", name: "x".repeat(41) }] }, false],
  ["action name with a line break", { ...valid, actions: [{ id: "reset", name: "Re\nset" }] }, false],
  ["unknown action field", { ...valid, actions: [{ id: "reset", name: "Reset", key: "F1" }] }, false],
  ["panels not a list", { ...valid, panels: { id: "planner", name: "Planner" } }, false],
  ["panel type without a name", { ...valid, panels: [{ id: "planner" }] }, false],
  ["panel name of 24 characters", { ...valid, panels: [{ id: "planner", name: "n".repeat(24) }] }, true],
  ["panel name of 25 characters", { ...valid, panels: [{ id: "planner", name: "n".repeat(25) }] }, false],
  ["blank panel name", { ...valid, panels: [{ id: "planner", name: " " }] }, false],
  ["uppercase panel id", { ...valid, panels: [{ id: "Planner", name: "Planner" }] }, false],
  ["panel id with a dot", { ...valid, panels: [{ id: "build.planner", name: "Planner" }] }, false],
  ["panel id of 33 characters", { ...valid, panels: [{ id: `p${"a".repeat(32)}`, name: "Planner" }] }, false],
  ["panel entry outside the package", { ...valid, panels: [{ id: "planner", name: "Planner", entry: "../x.html" }] }, false],
  ["panel entry not a page", { ...valid, panels: [{ id: "planner", name: "Planner", entry: "dist/x.js" }] }, false],
  ["svg panel icon", { ...valid, panels: [{ id: "planner", name: "Planner", icon: "x.svg" }] }, false],
  ["panel viewport without a height", { ...valid, panels: [{ id: "planner", name: "Planner", viewport: { minWidth: 100 } }] }, false],
  ["panel continues as a string", { ...valid, panels: [{ id: "planner", name: "Planner", continues: "yes" }] }, false],
  ["unknown panel field", { ...valid, panels: [{ id: "planner", name: "Planner", title: "x" }] }, false],
];

describe("panel types", () => {
  const two = (extra: object = {}) => ({ ...valid, panels: [{ id: "inventory", name: "Inventory" }, { id: "planner", name: "Build planner", ...extra }] });

  // Neither rule fits in the JSON Schema, so only the validator checks them.
  it("refuses an id given twice", () => {
    const result = validateManifest({ ...valid, panels: [{ id: "planner", name: "A" }, { id: "planner", name: "B" }] });
    expect(result).toEqual({ ok: false, errors: ["panels lists the id planner twice"] });
  });

  it("refuses two continuing types", () => {
    const result = validateManifest({ ...valid, panels: [{ id: "a", name: "A", continues: true }, { id: "b", name: "B", continues: true }] });
    expect(result).toEqual({ ok: false, errors: ["only one panel type may set continues"] });
  });

  it("fills in the module's entry, icon and viewport", () => {
    const manifest = { ...two({ entry: "dist/planner.html", viewport: { minWidth: 500, minHeight: 400 } }), icon: "icon.png" } as ModuleManifest;
    expect(panelTypes(manifest)).toEqual([
      { id: "inventory", name: "Inventory", entry: "dist/index.html", icon: "icon.png", viewport: valid.viewport },
      { id: "planner", name: "Build planner", entry: "dist/planner.html", icon: "icon.png", viewport: { minWidth: 500, minHeight: 400 } },
    ]);
    expect(panelTypes(valid as ModuleManifest)).toEqual([]);
  });

  it("continues older panels as the marked type, else the first", () => {
    expect(continuingPanelType(two({ continues: true }) as ModuleManifest)).toBe("planner");
    expect(continuingPanelType(two() as ModuleManifest)).toBe("inventory");
    expect(continuingPanelType(valid as ModuleManifest)).toBeNull();
  });
});

describe("permissions.onRequest", () => {
  it("only lists connectors the module also lists", () => {
    const result = validateManifest({ ...valid, permissions: { network: [], onRequest: ["stream-overlay"] } });
    expect(result).toEqual({ ok: false, errors: ["permissions.onRequest may only list connectors that permissions.connectors lists"] });
  });

  it("leaves connectors asked for on request out of what is asked when the module is added", () => {
    expect(connectorsAtAdd({ network: [], connectors: ["discord", "stream-overlay"], onRequest: ["stream-overlay"] })).toEqual(["discord"]);
    expect(connectorsAtAdd({ network: [], connectors: ["stream-overlay"] })).toEqual(["stream-overlay"]);
    expect(connectorsAtAdd({ network: [] })).toEqual([]);
  });
});

describe("actions", () => {
  it("refuses an id given twice", () => {
    const result = validateManifest({ ...valid, actions: [{ id: "reset", name: "Reset" }, { id: "reset", name: "Again" }] });
    expect(result).toEqual({ ok: false, errors: ["actions lists the id reset twice"] });
  });

  it("counts the overlay page among the files a package must hold", () => {
    const manifest = { ...valid, overlay: "dist/overlay.html", permissions: { network: [], connectors: ["stream-overlay"] } } as ModuleManifest;
    expect(manifestFiles(manifest).entries).toEqual([valid.entry, "dist/overlay.html"]);
  });
});


describe("translations", () => {
  const translated = {
    ...valid,
    minTavora: "0.21.0",
    description: "Plans builds.",
    panels: [{ id: "tree", name: "Tree" }, { id: "gear", name: "Gear" }],
    actions: [{ id: "reset", name: "Reset" }],
    translations: {
      de: { name: "Begleiter", description: "Plant Builds.", panels: { tree: "Baum", gear: "Ausrüstung" }, actions: { reset: "Zurücksetzen" } },
      "de-at": { name: "Begleiter (AT)" },
    },
  } as ModuleManifest;

  // Neither rule fits in the JSON Schema, so only the validator checks them.
  it("only names panels and actions the manifest lists", () => {
    const result = validateManifest({ ...translated, translations: { de: { panels: { map: "Karte" }, actions: { lap: "Runde" } } } });
    expect(result).toEqual({ ok: false, errors: ["translations.de.panels names map, which panels does not list", "translations.de.actions names lap, which actions does not list"] });
  });

  it("needs a Tavora newer than the last one without them, except for Tavora's own modules", () => {
    const error = { ok: false, errors: [`translations need a minTavora newer than ${LAST_TAVORA_WITHOUT_TRANSLATIONS}, because older Tavoras refuse them`] };
    expect(validateManifest({ ...translated, minTavora: undefined })).toEqual(error);
    expect(validateManifest({ ...translated, minTavora: LAST_TAVORA_WITHOUT_TRANSLATIONS })).toEqual(error);
    expect(validateManifest({ ...translated, minTavora: undefined, id: "tavora.companion" }).ok).toBe(true);
    expect(validateManifest(translated).ok).toBe(true);
  });

  it("shows the texts of the exact language, then its base language, then the plain fields", () => {
    const german = translateManifest(translated, "de");
    expect([german.name, german.description, german.panels!.map((type) => type.name), german.actions![0]!.name]).toEqual(["Begleiter", "Plant Builds.", ["Baum", "Ausrüstung"], "Zurücksetzen"]);
    const austrian = translateManifest(translated, "de-AT");
    expect([austrian.name, austrian.panels![0]!.name]).toEqual(["Begleiter (AT)", "Baum"]);
    expect(translateManifest(translated, "de-ch").name).toBe("Begleiter");
    expect(translateManifest(translated, "en")).toBe(translated);
    expect(translateManifest(valid as ModuleManifest, "de")).toBe(valid);
  });

  it("keeps the plain text where a translation leaves one out", () => {
    const partial = { ...translated, translations: { de: { panels: { gear: "Ausrüstung" } } } } as ModuleManifest;
    const german = translateManifest(partial, "de");
    expect([german.name, german.description, german.panels!.map((type) => type.name), german.actions![0]!.name]).toEqual(["Campaign Companion", "Plans builds.", ["Tree", "Ausrüstung"], "Reset"]);
  });
});
describe("needsNewerTavora", () => {
  it.each([
    [undefined, "0.17.0", false],
    ["0.18.0", "0.17.9", true],
    ["0.18.0", "0.18.0", false],
    ["0.18.0", "0.18.1", false],
    ["0.18.2", "0.18.10", false],
    ["1.0.0", "0.99.99", true],
    ["0.18.0", "0.19.0-dev", false],
    ["0.18.0", "0.18.0-dev", false],
  ] as const)("minTavora %s on Tavora %s needs a newer Tavora: %s", (minTavora, tavora, expected) => {
    expect(needsNewerTavora(minTavora === undefined ? {} : { minTavora }, tavora)).toBe(expected);
  });
});

describe("overlay without the stream-overlay connector", () => {
  const overlay = { ...valid, overlay: "dist/overlay.html" };

  it("needs a minTavora newer than the last Tavora that refuses it, because older Tavoras refuse it", () => {
    const error = { ok: false, errors: [`overlay without the "stream-overlay" connector needs a minTavora newer than ${LAST_TAVORA_WITHOUT_GAME_OVERLAYS}, because older Tavoras refuse it`] };
    expect(validateManifest(overlay)).toEqual(error);
    expect(validateManifest({ ...overlay, minTavora: LAST_TAVORA_WITHOUT_GAME_OVERLAYS })).toEqual(error);
    expect(validateManifest({ ...overlay, minTavora: "0.20.51" }).ok).toBe(true);
  });
});

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

describe("validateChangelog", () => {
  it("takes versions newest first, each with plain lines", () => {
    const entries = [
      { version: "1.1.0", date: "2026-10-18", notes: ["Filters by tag."] },
      { version: "1.0.0", notes: ["First release."] },
    ];
    expect(validateChangelog(entries)).toEqual({ ok: true, entries });
  });

  it("refuses what Tavora could not show safely or would misread", () => {
    expect(validateChangelog({ version: "1.0.0" }).ok).toBe(false);
    expect(validateChangelog([{ version: "1.0", notes: ["x"] }])).toEqual({ ok: false, errors: ["changelog[0].version must be semver, e.g. 1.0.0"] });
    expect(validateChangelog([{ version: "1.0.0", notes: ["a"] }, { version: "1.0.0", notes: ["b"] }])).toEqual({ ok: false, errors: ["changelog[1].version 1.0.0 is listed twice"] });
    expect(validateChangelog([{ version: "1.0.0", date: "18.10.2026", notes: ["x"] }]).ok).toBe(false);
    expect(validateChangelog([{ version: "1.0.0", notes: [] }]).ok).toBe(false);
    expect(validateChangelog([{ version: "1.0.0", notes: ["two\nlines"] }]).ok).toBe(false);
    expect(validateChangelog([{ version: "1.0.0", notes: ["x".repeat(CHANGELOG_LIMITS.maxNoteLength + 1)] }]).ok).toBe(false);
    expect(validateChangelog([{ version: "1.0.0", notes: ["x"], html: "<b>" }]).ok).toBe(false);
  });
});
