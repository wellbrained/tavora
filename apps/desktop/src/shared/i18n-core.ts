// The parts of Tavora's translations that do not carry the texts themselves, so the
// window can load a language when it needs it (see `renderer/i18n.ts`). The main
// process has every text at hand through `i18n.ts`, which builds on this file.
import type { en } from "./locales/en";

export type Language = "en" | "de";
/** What Settings stores: a language, or `system` to follow the operating system. */
export type LanguageSetting = "system" | Language;

/** Shown in each language's own name, so a user can find theirs whatever Tavora currently says. */
export const LANGUAGES: readonly { id: Language; name: string; /** Other names the language search finds it by. */ search: string }[] = [
  { id: "en", name: "English", search: "english englisch" },
  { id: "de", name: "Deutsch", search: "german deutsch" },
];

export function isLanguageSetting(value: unknown): value is LanguageSetting {
  return value === "system" || value === "en" || value === "de";
}

/** The language for a system locale such as `de-DE`; anything Tavora has no translation for is English. */
export function resolveLanguage(setting: LanguageSetting, systemLocale: string): Language {
  if (setting !== "system") return setting;
  return systemLocale.toLowerCase().split(/[-_]/)[0] === "de" ? "de" : "en";
}

type Key = keyof typeof en;
type PluralBase<K> = K extends `${infer Base}.other` ? Base : never;
/** A key, or the base of a `.one` / `.other` pair. */
export type MessageKey = Exclude<Key, `${string}.one` | `${string}.other`> | PluralBase<Key>;
export type Params = Record<string, string | number>;

/** The texts of one language by key. */
export type Catalog = Record<string, string>;
/** The texts at hand: English always (the fallback), and any other language once it is loaded. */
export type Catalogs = { en: Catalog } & Partial<Record<Language, Catalog>>;

const interpolate = (text: string, params?: Params) =>
  params ? text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match)) : text;

/** Looks a text up in a language, falling back to English and then to the key itself. A language that is not loaded reads as English. */
export function translateFrom(catalogs: Catalogs, language: Language, key: MessageKey, params?: Params): string {
  const catalog = catalogs[language] ?? catalogs.en;
  let found: string | undefined;
  if (typeof params?.count === "number") {
    const form = new Intl.PluralRules(language).select(params.count);
    found = catalog[`${key}.${form}`] ?? catalog[`${key}.other`];
  }
  found ??= catalog[key] ?? catalogs.en[key];
  return interpolate(found ?? catalogs.en[`${key}.other`] ?? key, params);
}

/** Dates and numbers follow the language, not the machine's own locale. */
export const intlLocale = (language: Language): string => (language === "de" ? "de-DE" : "en-GB");

/** Whether a text exists in English (which defines every key), for keys built from data such as a template's id. */
export const hasMessageIn = (english: Catalog, key: string): key is MessageKey => key in english || `${key}.other` in english;
