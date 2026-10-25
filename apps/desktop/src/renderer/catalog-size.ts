import { t } from "./i18n";

/** A zip's size for a module page or card. */
export function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? t("catalog.sizeKb", { size: Math.max(1, Math.round(bytes / 1024)) }) : t("catalog.sizeMb", { size: (bytes / 1024 / 1024).toFixed(1) });
}
