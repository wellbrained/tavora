import { describe, expect, it } from "vitest";
import { translate, type Language } from "./i18n";
import { problemText, type ModuleProblemKind } from "./module-problem";

const say = (language: Language, kind: ModuleProblemKind | undefined, values = {}, where: "modules" | "development" = "modules") =>
  problemText((key, params) => translate(language, key, params), where, kind, values, "my-tool");

describe("problemText", () => {
  it("words every kind in English", () => {
    expect(say("en", "unreadable")).toBe("can't load: its tavora.module.json can't be read.");
    expect(say("en", "invalid", { errors: "id is missing" })).toBe("can't load: its tavora.module.json isn't right (id is missing).");
    expect(say("en", "needs-newer", { needs: "0.18.0", current: "0.17.9" })).toBe("can't load: it needs Tavora 0.18.0 or newer, and you have 0.17.9.");
    expect(say("en", "icon-missing", { file: "icon.png" })).toBe("can't load: its icon file icon.png is missing.");
    expect(say("en", "reserved-id")).toBe("can't load: its id is only for Tavora's own modules.");
    expect(say("en", "webassembly")).toBe("can't load: only Tavora's own modules can use WebAssembly.");
    expect(say("en", "duplicate-id")).toBe("can't load: another module with the same id is already loaded.");
    expect(say("en", "blocked", { name: "Tracker", version: "1.0.0", reason: "It is bad." })).toBe(
      "Tavora stopped Tracker 1.0.0 because it can do harm: It is bad. Your data stays, and it comes back with a version that isn't blocked.",
    );
    expect(say("en", undefined)).toBe("Can't load this module.");
  });

  it("words them in German too, with the details", () => {
    expect(say("de", "unreadable")).toBe("lädt nicht: seine tavora.module.json lässt sich nicht lesen.");
    expect(say("de", "needs-newer", { needs: "0.18.0", current: "0.17.9" })).toBe("lädt nicht: es braucht Tavora 0.18.0 oder neuer, du hast 0.17.9.");
    expect(say("de", "icon-missing", { file: "icon.png" })).toBe("lädt nicht: seine Icon-Datei icon.png fehlt.");
    expect(say("de", "duplicate-id")).toBe("lädt nicht: ein anderes Modul mit derselben ID ist schon geladen.");
    expect(say("de", "blocked", { name: "Tracker", version: "1.0.0", reason: "Es ist schlecht." })).toContain("Tavora hat Tracker 1.0.0 gestoppt");
    expect(say("de", undefined)).toBe("Dieses Modul lässt sich nicht laden.");
  });

  it("uses the folder lists' own words for the development list", () => {
    expect(say("de", "webassembly", {}, "development")).toBe("Nicht geladen: nur Tavoras eigene Module dürfen WebAssembly nutzen.");
    expect(say("en", "not-built", {}, "development")).toContain("my-tool");
    expect(say("de", "missing", {}, "development")).toBe("Dieser Ordner ist nicht zu finden.");
  });

  it("has every text in both languages", () => {
    const kinds: ModuleProblemKind[] = ["not-built", "no-module", "missing", "unreadable", "invalid", "needs-newer", "icon-missing", "reserved-id", "webassembly", "duplicate-id", "blocked"];
    for (const kind of kinds) for (const where of ["modules", "development"] as const) {
      expect(say("en", kind, {}, where)).not.toMatch(/moduleProblem\./);
      expect(say("de", kind, {}, where)).not.toMatch(/moduleProblem\./);
    }
  });
});
