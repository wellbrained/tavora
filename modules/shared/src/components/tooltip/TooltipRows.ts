import { defineComponent, type PropType } from 'vue';
import { renderRows, type TooltipRow } from './rows';

export type { TooltipRow, TooltipTrend } from './rows';

const CLASSES = { root: 'tavora-tooltip-rows', head: 'tavora-tooltip-rows-head', heading: 'tavora-tooltip-rows-heading', unit: 'tavora-tooltip-unit' };

/**
 * Label and value pairs inside a tooltip, values lined up on the right: stats, chart values, item numbers. Several
 * values per row go under `columns` headings; a unit goes in a column of its own after them. The same rows show in a
 * panel as a `FactList`.
 */
export default defineComponent({
  name: 'TooltipRows',
  props: {
    rows: { type: Array as PropType<TooltipRow[]>, required: true },
    /** Headings over the values, one per column, such as levels or rarities. */
    columns: Array as PropType<string[]>,
  },
  setup(props) {
    return () => renderRows(props.rows, props.columns, CLASSES);
  },
});
