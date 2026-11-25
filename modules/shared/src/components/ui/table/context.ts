import { inject, type InjectionKey } from "vue"

/** How tight the rows are: `default` is the kit's usual height, `compact` for small tables in cards and leaderboards. */
export type TableDensity = "default" | "compact"
export type TableSortDirection = "ascending" | "descending"
/** Which column a table is sorted by. The table only shows and reports it: the module sorts its own rows. */
export interface TableSort {
  column: string
  direction: TableSortDirection
}

export interface TableContext {
  density: () => TableDensity
  stickyHeader: () => boolean
  sort: () => TableSort | null | undefined
  /** Called by a sortable head when it is pressed. */
  setSort: (sort: TableSort) => void
}

export const tableContextKey: InjectionKey<TableContext> = Symbol("tavora-table")

const outsideTable: TableContext = { density: () => "default", stickyHeader: () => false, sort: () => undefined, setSort: () => {} }

/** The options of the surrounding `Table`; parts used on their own get the defaults. */
export function useTableContext(): TableContext {
  return inject(tableContextKey, outsideTable)
}

/**
 * The sort after pressing a head: the sorted column flips its direction, any other column starts at `first`
 * (ascending unless the head says otherwise, for example descending for scores).
 */
export function nextSort(current: TableSort | null | undefined, column: string, first: TableSortDirection = "ascending"): TableSort {
  if (current?.column === column) return { column, direction: current.direction === "ascending" ? "descending" : "ascending" }
  return { column, direction: first }
}

/** What a row's numbers mean: better, worse, needs a look, or less important. */
export type TableRowTone = "positive" | "negative" | "warning" | "muted"
