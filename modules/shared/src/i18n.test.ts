import { describe, expect, it } from "vitest";
import { createTranslator } from "./i18n";

const en = { hello: "Hello {name}", "left.one": "{count} left", "left.other": "{count} left (many)", onlyEnglish: "Only here" } as const;
const de = { hello: "Hallo {name}", "left.one": "{count} übrig", "left.other": "{count} übrig (viele)", onlyEnglish: "Nur hier" };

describe("createTranslator", () => {
  it("starts in English, switches to German, and treats anything else as English", () => {
    const { t, setLanguage, locale } = createTranslator(en, de);
    expect(t("hello", { name: "Alex" })).toBe("Hello Alex");
    setLanguage("de-AT");
    expect(t("hello", { name: "Alex" })).toBe("Hallo Alex");
    expect(locale()).toBe("de-DE");
    setLanguage("fr");
    expect(t("hello", { name: "Alex" })).toBe("Hello Alex");
    expect(locale()).toBe("en-GB");
  });

  it("picks the plural form and fills in the count", () => {
    const { plural, setLanguage } = createTranslator(en, de);
    expect(plural("left", 1)).toBe("1 left");
    expect(plural("left", 3)).toBe("3 left (many)");
    setLanguage("de");
    expect(plural("left", 1)).toBe("1 übrig");
  });

  it("leaves a placeholder alone when no value is given", () => {
    expect(createTranslator(en, de).t("hello")).toBe("Hello {name}");
  });
});
