import { createTranslator } from "@tavora/official-ui";
import { de, en } from "./locales";

/** Clock & Counter's texts, in the language Tavora reports. */
export const { t, plural, language, setLanguage, locale } = createTranslator(en, de);
