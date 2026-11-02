import { createTranslator } from "@tavora/official-ui";
import { de, en, type TextKey } from "./locales";

/** The playground's texts, in the language Tavora reports. */
export const { t, language, setLanguage } = createTranslator(en, de);

/** A text whose key is put together (a page's or an example's); undefined when there is none. */
export const maybe = (key: string): string | undefined => (key in en ? t(key as TextKey) : undefined);
