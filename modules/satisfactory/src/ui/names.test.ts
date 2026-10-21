import { describe, expect, it } from "vitest";
import { sampleData } from "../data/sample";
import { itemName, localize, wikiUrl } from "./names";

describe("localize", () => {
  it("shows German for de and its regional forms, English otherwise", () => {
    const text = { en: "Iron Plate", de: "Eisenplatte" };
    expect(localize(text, "de")).toBe("Eisenplatte");
    expect(localize(text, "de-AT")).toBe("Eisenplatte");
    expect(localize(text, "en")).toBe("Iron Plate");
    expect(localize(text, "fr")).toBe("Iron Plate");
  });

  it("falls back to English when there is no German", () => {
    expect(localize({ en: "Iron Plate" }, "de")).toBe("Iron Plate");
    expect(localize({ en: "Iron Plate", de: "" }, "de")).toBe("Iron Plate");
  });
});

describe("itemName", () => {
  it("names known items and shows the id of unknown ones", () => {
    expect(itemName(sampleData, "Desc_IronScrew_C", "de")).toBe("Schrauben");
    expect(itemName(sampleData, "Desc_Nothing_C", "en")).toBe("Desc_Nothing_C");
  });
});

describe("wikiUrl", () => {
  it("uses the English name with underscores, encoded", () => {
    expect(wikiUrl({ en: "Reinforced Iron Plate", de: "Verstärkte Eisenplatte" })).toBe("https://satisfactory.wiki.gg/wiki/Reinforced_Iron_Plate");
    expect(wikiUrl({ en: "Alternate: Cast Screw" })).toBe("https://satisfactory.wiki.gg/wiki/Alternate%3A_Cast_Screw");
    expect(wikiUrl({ en: "Blueprint Designer Mk.2" })).toBe("https://satisfactory.wiki.gg/wiki/Blueprint_Designer_Mk.2");
  });
});
