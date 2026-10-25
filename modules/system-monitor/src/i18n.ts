import { createTranslator } from "@tavora/official-ui";
import { de, en } from "./locales";

/** System Monitor's texts, in the language Tavora reports. */
export const { t, plural, language, setLanguage, locale } = createTranslator(en, de);
