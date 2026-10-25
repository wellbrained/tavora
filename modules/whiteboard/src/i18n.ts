import { createTranslator } from "@tavora/official-ui";
import { de, en } from "./locales";

/** The Whiteboard's texts, in the language Tavora reports. */
export const { t, language, setLanguage } = createTranslator(en, de);
