// Tavora's own texts in English and German. Messages live in `locales/en.ts`
// (the source: every key is defined there) and `locales/de.ts` (must define
// the same keys; the type checker and a unit test make sure). A text with a
// number has `.one` and `.other` forms and is called with `{ count }`.
// Docs, patch notes and developer-facing messages stay English.
//
// This file has both languages at hand, for the main process. The window loads a
// language when it needs it and builds on `i18n-core.ts` instead (`renderer/i18n.ts`):
// importing this file there would put both languages back into its first load.
import { translateFrom, hasMessageIn, type Language, type MessageKey, type Params } from "./i18n-core";
import { de } from "./locales/de";
import { en } from "./locales/en";

export * from "./i18n-core";

const catalogs = { en, de };

/** Looks a text up in a language, falling back to English and then to the key itself. */
export const translate = (language: Language, key: MessageKey, params?: Params): string => translateFrom(catalogs, language, key, params);

/** Whether a text exists, for keys built from data such as a template's id. */
export const hasMessage = (key: string): key is MessageKey => hasMessageIn(en, key);
