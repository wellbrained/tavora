import { defineComponent, h, type PropType } from 'vue';

export interface TooltipRow {
  label: string;
  value: string;
  /** Green when this is better than before or than the other choice, red when worse. */
  trend?: 'better' | 'worse';
}

/** Label and value pairs inside a tooltip, values lined up on the right: stats, chart values, item numbers. */
export default defineComponent({
  name: 'TooltipRows',
  props: { rows: { type: Array as PropType<TooltipRow[]>, required: true } },
  setup(props) {
    return () => h('dl', { class: 'tavora-tooltip-rows' }, props.rows.flatMap(row => [
      h('dt', row.label),
      h('dd', { 'data-trend': row.trend }, row.value),
    ]));
  },
});
