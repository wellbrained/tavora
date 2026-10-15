import { describe, expect, it } from "vitest";
import { GROUPS, SETTING_SECTIONS } from "../renderer/components/settings/settings-index";
import { intlLocale, isLanguageSetting, LANGUAGES, resolveLanguage, translate, type MessageKey } from "./i18n";
import { de } from "./locales/de";
import { en } from "./locales/en";

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
const keys = Object.keys(en) as (keyof typeof en)[];

describe("locale files", () => {
  it("define the same keys in English and German", () => {
    expect(Object.keys(de).sort()).toEqual([...keys].sort());
  });

  it("have no empty texts", () => {
    for (const key of keys) {
      expect(en[key].trim(), `en ${key}`).not.toBe("");
      expect(de[key].trim(), `de ${key}`).not.toBe("");
    }
  });

  it("use the same {placeholders} in both languages", () => {
    for (const key of keys) expect(placeholders(de[key]), key).toEqual(placeholders(en[key]));
  });

  it("have .one and .other together", () => {
    for (const key of keys) {
      if (key.endsWith(".one")) expect(keys, key).toContain(key.replace(/\.one$/, ".other"));
      if (key.endsWith(".other")) expect(keys, key).toContain(key.replace(/\.other$/, ".one"));
    }
  });

  it("word every searchable setting and section", () => {
    for (const [id] of SETTING_SECTIONS) {
      for (const part of ["label", "search", "keywords", "description"]) expect(keys, `settings.${id}.${part}`).toContain(`settings.${id}.${part}`);
    }
    for (const group of GROUPS) {
      expect(keys).toContain(`settings.group.${group.id}`);
      for (const section of group.sections) expect(keys).toContain(`settings.section.${section.id}`);
    }
    expect(keys).toContain("settings.section.patch-notes");
  });
});

describe("resolveLanguage", () => {
  it("follows the system's language, with English for anything else", () => {
    expect(resolveLanguage("system", "de")).toBe("de");
    expect(resolveLanguage("system", "de-AT")).toBe("de");
    expect(resolveLanguage("system", "DE_de")).toBe("de");
    expect(resolveLanguage("system", "en-US")).toBe("en");
    expect(resolveLanguage("system", "fr")).toBe("en");
    expect(resolveLanguage("system", "")).toBe("en");
  });

  it("keeps a chosen language whatever the system says", () => {
    expect(resolveLanguage("en", "de")).toBe("en");
    expect(resolveLanguage("de", "en-US")).toBe("de");
  });

  it("knows which values are settings", () => {
    for (const value of ["system", ...LANGUAGES.map((language) => language.id)]) expect(isLanguageSetting(value)).toBe(true);
    for (const value of ["fr", "", null, 3]) expect(isLanguageSetting(value)).toBe(false);
  });
});

describe("translate", () => {
  it("fills in placeholders and leaves unknown ones alone", () => {
    expect(translate("en", "settings.updates.available", { version: "1.2.3" })).toBe("Version 1.2.3 is available.");
    expect(translate("de", "settings.updates.available", { version: "1.2.3" })).toBe("Version 1.2.3 ist verfügbar.");
    expect(translate("en", "settings.updates.available")).toBe("Version {version} is available.");
  });

  it("falls back to the key itself for a text that does not exist", () => {
    expect(translate("de", "nope.nothing" as MessageKey)).toBe("nope.nothing");
  });

  it("formats dates and numbers in the language's style", () => {
    expect(intlLocale("de")).toBe("de-DE");
    expect(intlLocale("en")).toBe("en-GB");
  });
});
