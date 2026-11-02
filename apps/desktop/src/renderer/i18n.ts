// The host UI's texts. `t` reads the current language, so a text in a
// template or a computed value changes when the language does.
import { setUiLanguage } from "@tavora/official-ui/components/ui/text";
import { ref, shallowReactive } from "vue";
import { hasMessageIn, intlLocale, translateFrom, type Catalog, type Catalogs, type Language, type MessageKey, type Params } from "../shared/i18n-core";
// English is the fallback and the first paint. The other languages come when the app is set to one,
// so the window does not load texts it never shows.
import { en } from "../shared/locales/en";

export const language = ref<Language>("en");
/** Whether a language was set, from the app's state; until then "en" is only the default. */
export let languageSet = false;

const catalogs = shallowReactive<Catalogs>({ en });
const loaders: Record<Exclude<Language, "en">, () => Promise<Catalog>> = {
  de: () => import("../shared/locales/de").then((module) => module.de),
};
let latest = 0;

/** Whether a language's texts are at hand, so switching to it takes no waiting. */
export const isLanguageReady = (next: Language): boolean => Boolean(catalogs[next]);

/**
 * Brings a language's texts in without switching to it, so a state that asks for it can wait and the window
 * never shows English on the way. Never rejects: texts that will not load leave English up.
 */
export async function loadLanguage(next: Language): Promise<void> {
  if (next === "en" || isLanguageReady(next)) return;
  try {
    catalogs[next] = await loaders[next]();
  } catch (error) {
    console.error(`Could not load the ${next} texts`, error);
  }
}

/** Switches the window to a language; with its texts at hand that happens at once. A newer call makes an older, slower one give way. */
export function setLanguage(next: Language): Promise<void> | void {
  languageSet = true;
  const turn = ++latest;
  const apply = () => {
    language.value = next;
    document.documentElement.lang = next;
    setUiLanguage(next);
  };
  if (isLanguageReady(next)) return apply();
  return loadLanguage(next).then(() => {
    if (turn === latest && isLanguageReady(next)) apply();
  });
}

export function t(key: MessageKey, params?: Params): string {
  return translateFrom(catalogs, language.value, key, params);
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
  return hasMessageIn(en, key) ? t(key) : template.name;
}

/** How long ago a moment was, in the language's own words ("2 minutes ago"). */
export function formatAgo(at: number, now = Date.now()): string {
  const seconds = Math.round((at - now) / 1000);
  const format = new Intl.RelativeTimeFormat(intlLocale(language.value), { numeric: "auto" });
  if (Math.abs(seconds) < 60) return format.format(seconds, "second");
  if (Math.abs(seconds) < 3600) return format.format(Math.round(seconds / 60), "minute");
  if (Math.abs(seconds) < 86_400) return format.format(Math.round(seconds / 3600), "hour");
  return format.format(Math.round(seconds / 86_400), "day");
}
