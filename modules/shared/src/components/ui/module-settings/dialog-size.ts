// How big a module's settings dialog asks to be (the size it hands to panel.openDialog), so modules don't work it out each.
// A page's height here is what the dialog shows under its frame's header; Tavora adds the header.

/** The dialog of a module with several pages: the same size in every module, so dialogs don't jump around. */
export const SETTINGS_DIALOG = { width: 960, height: 680 } as const;

/** The menu on the left of a module with several pages (ModuleSettings draws it 200px wide: keep the two in step). */
export const SETTINGS_MENU_WIDTH = 200;

/** One row of a page, with its divider, and the rest of the page around its rows: title and sentence, space above the first section, space below, and the footer. */
const ROW_HEIGHT = 57;
const PAGE_AROUND = 88 + 24 + 24 + 48;

/** A single page never gets shorter than this many rows. */
export const SETTINGS_MIN_ROWS = 6;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * The size to ask for with `panel.openDialog(settingsDialogSize({ pages, rows }))`.
 *
 * With several pages the dialog has the usual size. With only one page it has no menu, so it is narrower by the menu's
 * width, and as tall as its rows need: at least six rows, at most the usual height, where the page scrolls. `rows` is
 * how many rows the page has at most (leave it out for the usual height).
 */
export function settingsDialogSize(options: { pages: number; rows?: number }): { width: number; height: number } {
  if (options.pages > 1) return { ...SETTINGS_DIALOG };
  const rows = options.rows ?? Infinity;
  const wanted = PAGE_AROUND + Math.max(SETTINGS_MIN_ROWS, rows) * ROW_HEIGHT;
  return { width: SETTINGS_DIALOG.width - SETTINGS_MENU_WIDTH, height: clamp(Math.ceil(wanted), PAGE_AROUND + SETTINGS_MIN_ROWS * ROW_HEIGHT, SETTINGS_DIALOG.height) };
}
