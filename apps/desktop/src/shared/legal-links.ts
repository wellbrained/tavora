import type { LegalPage } from "./host-api";
import type { Language } from "./i18n";

/** Tavora's legal pages on its website: the English one, and the German one under /de/. */
export function legalPageUrl(page: LegalPage, language: Language): string {
  return `https://mytavora.app/${page}/${language === "de" ? "de/" : ""}`;
}
