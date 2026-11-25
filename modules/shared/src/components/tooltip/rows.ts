// Label and value rows, shared by TooltipRows (inside a tooltip) and FactList (in a panel): one row model, one grid.
import { h, type VNode } from 'vue';
import { uiText } from '../ui/text';

/** Green when a value is better than before or than the other choice, red when worse. */
export type TooltipTrend = 'better' | 'worse';

export interface TooltipRow {
  label: string;
  /** The row's value. With `columns`, use `values` instead. */
  value?: string;
  /** One value per column, under the `columns` headings. A "–" is drawn faint: nothing there, or no change. */
  values?: string[];
  /** A unit such as "%" or "min", in a column of its own after the values, so the numbers line up. */
  unit?: string;
  /** For the row's value, or for each of its `values` in turn (a single one goes for all of them). */
  trend?: TooltipTrend | (TooltipTrend | undefined)[];
}

/** The class names a list of rows draws with: the tooltip's own, or the panel's. */
export interface RowClasses {
  root: string;
  head: string;
  heading: string;
  unit: string;
}

/** The host card's "nothing here" mark, drawn faint. */
const FAINT = '–';

/**
 * A small triangle, up for better and down for worse, so a trend is never told by its colour alone; screen readers hear
 * the word instead. In the value's own colour.
 */
export function trendMark(trend: TooltipTrend | undefined): VNode[] {
  if (!trend) return [];
  const up = trend === 'better';
  return [
    h('svg', { 'data-slot': 'trend-mark', viewBox: '0 0 8 8', width: '0.55em', height: '0.55em', 'aria-hidden': 'true', style: 'display:inline-block;margin-right:0.3em;vertical-align:0.05em;fill:currentColor' }, [
      h('path', { d: up ? 'M4 0.5 7.8 7.5H0.2Z' : 'M4 7.5 0.2 0.5H7.8Z' }),
    ]),
  ];
}

/** A row's trend for its value, or for one of its `values`. */
export const trendAt = (row: TooltipRow, index = 0): TooltipTrend | undefined => Array.isArray(row.trend) ? row.trend[index] : row.trend;

/** The word for a trend, read after the value by screen readers only. */
export function trendWord(trend: TooltipTrend | undefined): VNode[] {
  if (!trend) return [];
  return [h('span', { class: 'sr-only' }, ` ${trend === 'better' ? uiText.value.trendBetter : uiText.value.trendWorse}`)];
}

/**
 * The rows as a `<dl>`: plain label and value rows stay a simple two-column grid; with units or columns each row is a
 * div of a dt and its dd's (the grid reaches through it), and the headings are a row of their own.
 */
export function renderRows(rows: readonly TooltipRow[], columns: readonly string[] | undefined, classes: RowClasses, extra: { class?: unknown; labelColumn?: string; attrs?: Record<string, unknown> } = {}): VNode {
  const cellsOf = (row: TooltipRow) => row.values ?? [row.value ?? ''];
  const count = Math.max(1, columns?.length ?? 0, ...rows.map(row => cellsOf(row).length));
  const hasUnit = rows.some(row => row.unit);
  const plain = count === 1 && !hasUnit && !columns?.length;
  /** One value. A faint "–" only where rows have units or columns, so plain rows look as they always did. */
  const cell = (row: TooltipRow, index: number, faint: boolean) => {
    const text = cellsOf(row)[index] ?? '';
    const trend = trendAt(row, index);
    return h('dd', { 'data-trend': trend, 'data-faint': faint && text === FAINT ? 'true' : undefined }, trend ? [...trendMark(trend), text, ...trendWord(trend)] : text);
  };
  const root = [classes.root, extra.class];
  // A caller that sets the label column gets the grid on plain rows too; the tooltip's plain rows keep tooltip.css's.
  if (plain) return h('dl', { ...extra.attrs, class: root, style: extra.labelColumn ? { gridTemplateColumns: `${extra.labelColumn} auto` } : undefined }, rows.flatMap(row => [h('dt', row.label), cell(row, 0, false)]));
  const indexes = Array.from({ length: count }, (_, index) => index);
  const heads = columns?.length ? h('div', { class: classes.head }, [
    h('dt', { 'aria-hidden': 'true' }),
    ...indexes.map(index => h('dd', { class: classes.heading }, columns[index] ?? '')),
    hasUnit ? h('dd', { 'aria-hidden': 'true' }) : null,
  ]) : null;
  return h('dl', {
    ...extra.attrs,
    class: root,
    'data-columns': count > 1 ? count : undefined,
    style: { gridTemplateColumns: `${extra.labelColumn ?? 'minmax(0,1fr)'} repeat(${count},auto)${hasUnit ? ' auto' : ''}` },
  }, [heads, ...rows.map(row => h('div', [
    h('dt', row.label),
    ...indexes.map(index => cell(row, index, true)),
    hasUnit ? h('dd', { class: classes.unit }, row.unit ?? '') : null,
  ]))]);
}
