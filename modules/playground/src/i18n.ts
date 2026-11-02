import { createTranslator } from "@tavora/official-ui";
import { de, en } from "./locales";

/** The Playground's own texts, in the language Tavora reports. */
export const { t, language, setLanguage } = createTranslator(en, de);
