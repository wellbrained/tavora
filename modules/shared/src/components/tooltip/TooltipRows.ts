import { computed, defineComponent, h, type PropType } from 'vue';

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

/** The host card's "nothing here" mark, drawn faint. */
const FAINT = '–';

/**
 * Label and value pairs inside a tooltip, values lined up on the right: stats, chart values, item numbers. Several
 * values per row go under `columns` headings; a unit goes in a column of its own after them.
 */
export default defineComponent({
  name: 'TooltipRows',
  props: {
    rows: { type: Array as PropType<TooltipRow[]>, required: true },
    /** Headings over the values, one per column, such as levels or rarities. */
    columns: Array as PropType<string[]>,
  },
  setup(props) {
    const cellsOf = (row: TooltipRow) => row.values ?? [row.value ?? ''];
    const count = computed(() => Math.max(1, props.columns?.length ?? 0, ...props.rows.map(row => cellsOf(row).length)));
    const unit = computed(() => props.rows.some(row => row.unit));
    // Plain label and value rows keep the simple two-column grid from tooltip.css.
    const plain = computed(() => count.value === 1 && !unit.value && !props.columns?.length);
    const trendAt = (row: TooltipRow, index: number) => Array.isArray(row.trend) ? row.trend[index] : row.trend;
    /** One value. A faint "–" only where rows have units or columns, so plain rows look as they always did. */
    const cell = (row: TooltipRow, index: number, faint: boolean) => {
      const text = cellsOf(row)[index] ?? '';
      return h('dd', { 'data-trend': trendAt(row, index), 'data-faint': faint && text === FAINT ? 'true' : undefined }, text);
    };
    return () => {
      if (plain.value) return h('dl', { class: 'tavora-tooltip-rows' }, props.rows.flatMap(row => [h('dt', row.label), cell(row, 0, false)]));
      const n = count.value, indexes = Array.from({ length: n }, (_, index) => index);
      // Each row is a div of a dt and its dd's (the grid reaches through it); the headings are a row of their own.
      const heads = props.columns?.length ? h('div', { class: 'tavora-tooltip-rows-head' }, [
        h('dt', { 'aria-hidden': 'true' }),
        ...indexes.map(index => h('dd', { class: 'tavora-tooltip-rows-heading' }, props.columns![index] ?? '')),
        unit.value ? h('dd', { 'aria-hidden': 'true' }) : null,
      ]) : null;
      return h('dl', {
        class: 'tavora-tooltip-rows',
        'data-columns': n > 1 ? n : undefined,
        style: { gridTemplateColumns: `minmax(0,1fr) repeat(${n},auto)${unit.value ? ' auto' : ''}` },
      }, [heads, ...props.rows.map(row => h('div', [
        h('dt', row.label),
        ...indexes.map(index => cell(row, index, true)),
        unit.value ? h('dd', { class: 'tavora-tooltip-unit' }, row.unit ?? '') : null,
      ]))]);
    };
  },
});
