// The host UI's texts. `t` reads the current language, so a text in a
// template or a computed value changes when the language does.
import { setUiLanguage } from "@tavora/official-ui/components/ui/text";
import { ref } from "vue";
import { hasMessage, intlLocale, translate, type Language, type MessageKey, type Params } from "../shared/i18n";

export const language = ref<Language>("en");

export function setLanguage(next: Language): void {
  language.value = next;
  document.documentElement.lang = next;
  setUiLanguage(next);
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

/** "3 × 2 grid", or "3 columns" and "2 rows" when there is only one of the other. */
export function gridLabel(columns: number, rows: number): string {
  if (rows === 1) return columns === 1 ? t("layout.grid.slot") : t("layout.grid.columns", { columns });
  if (columns === 1) return t("layout.grid.rows", { rows });
  return t("layout.grid.both", { columns, rows });
}

/** A layout template's name in the current language; an even grid is named by its size. */
export function templateName(template: { id: string; name: string }): string {
  const grid = /^grid-(\d+)x(\d+)$/.exec(template.id);
  if (grid) return gridLabel(Number(grid[1]), Number(grid[2]));
  const key = `layout.template.${template.id}`;
  return hasMessage(key) ? t(key) : template.name;
}
