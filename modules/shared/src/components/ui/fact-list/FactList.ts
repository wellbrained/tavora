// Facts in a panel: a label and its value, the same rows a tooltip shows with TooltipRows. `inline` puts each value on
// the label's line, numbers lined up on the right (`align="start"`: right after the label, for text-heavy facts);
// `stacked` puts the label over the value, in as many columns as fit the width.
import { defineComponent, h, type PropType } from "vue"
import { cn } from "../../../lib/utils"
import EmptyState from "../empty-state/EmptyState.vue"
import { uiText } from "../text"
import { renderRows, trendAt, trendMark, trendWord, type TooltipRow } from "../../tooltip/rows"

/** One fact: the same row a tooltip shows with TooltipRows. */
export type FactRow = TooltipRow

const TREND = "[&_dd[data-trend=better]]:text-success [&_dd[data-trend=worse]]:text-destructive"
const INLINE = cn(
  "grid gap-x-4 gap-y-1 text-sm [&>div]:contents [&_dt]:text-muted-foreground [&_dt]:min-w-0 [&_dd]:m-0 [&_dd]:tabular-nums [&_dd]:[overflow-wrap:anywhere]",
  "data-[columns]:gap-x-3 [&_dd[data-faint]]:text-muted-foreground/70",
  TREND,
)
const CLASSES = {
  head: "",
  heading: "text-muted-foreground text-xs font-normal",
  unit: "text-muted-foreground -ml-2 text-left!",
}

export default defineComponent({
  name: "FactList",
  props: {
    rows: { type: Array as PropType<FactRow[]>, required: true },
    /** Headings over the values, one per column (inline only), such as levels or rarities. */
    columns: Array as PropType<string[]>,
    /** `inline`: label and value on one line. `stacked`: label over value, in columns that fit the width. */
    layout: { type: String as PropType<"inline" | "stacked">, default: "inline" },
    /** Inline only. `end`: values on the right, lined up. `start`: each value right after the label column. */
    align: { type: String as PropType<"end" | "start">, default: "end" },
    class: [String, Array, Object] as PropType<unknown>,
  },
  setup(props) {
    return () => {
      // No facts: the kit's empty look, not a blank gap.
      if (props.rows.length === 0) return h(EmptyState, { "data-slot": "fact-list", title: uiText.value.noData, class: cn("py-6", props.class as string) })
      if (props.layout === "stacked") {
        return h(
          "dl",
          { "data-slot": "fact-list", "data-layout": "stacked", class: cn("m-0 grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-x-4 gap-y-3 text-sm", TREND, props.class as string) },
          props.rows.map((row) => {
            const value = row.values?.join(" · ") ?? row.value ?? ""
            const trend = trendAt(row)
            return h("div", { class: "flex min-w-0 flex-col gap-0.5" }, [
              h("dt", { class: "text-muted-foreground truncate text-xs" }, row.label),
              h("dd", { class: "m-0 font-medium tabular-nums [overflow-wrap:anywhere]", "data-trend": trend }, [
                ...trendMark(trend),
                value,
                row.unit ? h("span", { class: "text-muted-foreground ml-1 font-normal" }, row.unit) : null,
                ...trendWord(trend),
              ]),
            ])
          }),
        )
      }
      const start = props.align === "start"
      return renderRows(props.rows, props.columns, { root: INLINE, ...CLASSES }, {
        class: cn(start ? "justify-start [&_dd]:text-left" : "[&_dd]:text-right", props.class as string),
        // The label keeps a fair share however long the values are; a long value wraps instead.
        labelColumn: start ? "fit-content(50%)" : "minmax(min(7rem,45%),1fr)",
        attrs: { "data-slot": "fact-list", "data-layout": "inline", "data-align": props.align },
      })
    }
  },
})
