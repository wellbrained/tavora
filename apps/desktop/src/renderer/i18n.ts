// The host UI's texts. `t` reads the current language, so a text in a
// template or a computed value changes when the language does.
import { ref } from "vue";
import { intlLocale, translate, type Language, type MessageKey, type Params } from "../shared/i18n";

export const language = ref<Language>("en");

export function setLanguage(next: Language): void {
  language.value = next;
  document.documentElement.lang = next;
}

export function t(key: MessageKey, params?: Params): string {
  return translate(language.value, key, params);
}

/** A date or time in the language's own style. */
export function formatDate(value: Date | string, options: Intl.DateTimeFormatOptions = { dateStyle: "medium" }): string {
  return new Intl.DateTimeFormat(intlLocale(language.value), options).format(typeof value === "string" ? new Date(value) : value);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(intlLocale(language.value)).format(value);
}
