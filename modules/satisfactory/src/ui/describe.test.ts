import { describe, expect, it } from "vitest";
import { sampleData } from "../data/sample";
import { en } from "../locales";
import { amountText, rateText, solveErrorText, unlockText, type T } from "./describe";

const t: T = (key, params) => en[key].replace(/\{(\w+)\}/g, (match, name: string) => (params && name in params ? String(params[name]) : match));

describe("unlockText", () => {
  it("describes every way to unlock a recipe", () => {
    expect(unlockText({ kind: "start" }, "en", t)).toBe("From the start");
    expect(unlockText({ kind: "milestone", tier: 2, name: { en: "Part Assembly" } }, "en", t)).toBe("Tier 2: Part Assembly");
    expect(unlockText({ kind: "mam", tree: { en: "Caterium" }, name: { en: "Quickwire" } }, "en", t)).toBe("MAM: Caterium, Quickwire");
    expect(unlockText({ kind: "hardDrive" }, "en", t)).toBe("Hard drive");
    expect(unlockText({ kind: "awesomeShop", name: { en: "Ficsmas" } }, "en", t)).toBe("AWESOME Shop: Ficsmas");
    expect(unlockText({ kind: "other", name: { en: "Tutorial", de: "Einführung" } }, "de", t)).toBe("Einführung");
  });
});

describe("solveErrorText", () => {
  it("names the recipe for locked and wrong recipes", () => {
    expect(solveErrorText({ code: "LOCKED_RECIPE", recipe: "Recipe_Alternate_Screw_C", item: "Desc_IronScrew_C" }, sampleData, "en", t)).toBe(
      "Alternate: Cast Screw is an alternate you haven't unlocked in this world.",
    );
    expect(solveErrorText({ code: "WRONG_RECIPE", recipe: "Recipe_IronRod_C", item: "Desc_IronScrew_C" }, sampleData, "en", t)).toBe("Iron Rod doesn't make Screws.");
    expect(solveErrorText({ code: "INFEASIBLE" }, sampleData, "en", t)).toBe(en["error.infeasible"]);
    expect(solveErrorText({ code: "INVALID_PLAN", reason: "BAD_RATE", message: "x" }, sampleData, "en", t)).toBe(en["error.badRate"]);
    expect(solveErrorText({ code: "INVALID_PLAN", reason: "NO_TARGETS", message: "x" }, sampleData, "en", t)).toBe(en["error.noTargets"]);
    // An item that left the game has no name any more: its id stands in.
    expect(solveErrorText({ code: "INVALID_PLAN", reason: "UNKNOWN_ITEM", item: "Desc_Gone_C", message: "x" }, sampleData, "en", t)).toBe("Desc_Gone_C is no longer in the game.");
    expect(solveErrorText({ code: "INVALID_PLAN", reason: "UNKNOWN_RECIPE", recipe: "Recipe_Gone_C", message: "x" }, sampleData, "en", t)).toBe(
      "A recipe you picked (Recipe_Gone_C) is no longer in the game.",
    );
  });
});

describe("units", () => {
  it("uses m³ for fluids", () => {
    expect(rateText(sampleData, "Desc_IronPlate_C", 20, "en-GB", t)).toBe("20 /min");
    expect(rateText(sampleData, "Desc_Water_C", 7.5, "en-GB", t)).toBe("7.5 m³/min");
    expect(amountText(sampleData, "Desc_IronRod_C", 5, "en-GB")).toBe("× 5");
    expect(amountText(sampleData, "Desc_Water_C", 2, "en-GB")).toBe("2 m³");
  });
});
