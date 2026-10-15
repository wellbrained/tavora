// Texts for a module in English and German, following the language Tavora
// reports through the SDK (`ui.getLanguage`, `ui.onLanguageChange`). Each module
// keeps its own `en` and `de` catalogs; a text with a number has `.one` and
// `.other` forms and is read with `plural`.

import { ref, type Ref } from "vue";

export type Params = Record<string, string | number>;

type PluralBase<K> = K extends `${infer Base}.other` ? Base : never;

export interface Translator<K extends string> {
  /** The language shown now, such as "en" or "de". */
  language: Ref<string>;
  setLanguage(language: string): void;
  t(key: K, params?: Params): string;
  /** A text with `.one` and `.other` forms, chosen by `count` (also filled in as `{count}`). */
  plural(key: PluralBase<K>, count: number, params?: Params): string;
  /** The locale for `Intl` and `toLocale…String` in the language shown. */
  locale(): string;
}

const fill = (text: string, params?: Params) =>
  params ? text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match)) : text;

/** Anything but German is English, as in the host. */
const isGerman = (language: string) => language.toLowerCase().split(/[-_]/)[0] === "de";

export function createTranslator<K extends string>(en: Record<K, string>, de: Record<K, string>): Translator<K> {
  const language = ref("en");
  const catalog = (): Record<string, string> => (isGerman(language.value) ? de : en);
  const lookup = (key: string) => catalog()[key] ?? (en as Record<string, string>)[key] ?? key;
  return {
    language,
    setLanguage: (next) => {
      language.value = next;
      if (typeof document !== "undefined") document.documentElement.lang = isGerman(next) ? "de" : "en";
    },
    t: (key, params) => fill(lookup(key), params),
    plural: (key, count, params) => {
      const form = new Intl.PluralRules(isGerman(language.value) ? "de" : "en").select(count);
      const text = `${key}.${form}` in catalog() ? lookup(`${key}.${form}`) : lookup(`${key}.other`);
      return fill(text, { count, ...params });
    },
    locale: () => (isGerman(language.value) ? "de-DE" : "en-GB"),
  };
}
