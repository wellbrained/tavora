// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { createApp, defineComponent, h, nextTick, ref, type App, type VNode } from "vue"
import { nextSort, Table, TableBody, TableCell, TableGroup, TableHead, TableHeader, TableNote, TableRow, type TableSort } from "."

let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ""
})

function mount(render: () => VNode) {
  const root = document.createElement("div")
  document.body.append(root)
  app = createApp(defineComponent({ render }))
  app.mount(root)
  return root
}
const q = (root: HTMLElement, slot: string) => root.querySelector(`[data-slot=${slot}]`) as HTMLElement
const classes = (el: Element) => [...el.classList].sort().join(" ")

describe("Table", () => {
  it("looks as it always did without options", () => {
    const root = mount(() =>
      h(Table, null, () => [
        h(TableHeader, null, () => h(TableRow, null, () => h(TableHead, null, () => "Item"))),
        h(TableBody, null, () => h(TableRow, null, () => h(TableCell, null, () => "Flour"))),
      ]),
    )
    expect(classes(q(root, "table-container"))).toBe("overflow-x-auto relative w-full")
    expect(classes(q(root, "table"))).toBe("caption-bottom text-sm w-full")
    expect(classes(q(root, "table-header"))).toBe("[&_tr]:border-b")
    expect(classes(q(root, "table-head"))).toBe("align-middle font-medium h-9 px-2 text-left text-muted-foreground text-xs")
    expect(classes(q(root, "table-cell"))).toBe("align-middle p-2")
    const row = root.querySelectorAll("[data-slot=table-row]")[1]!
    expect(classes(row)).toBe("border-b data-[state=selected]:bg-muted hover:bg-muted/50 transition-colors")
    expect(row.hasAttribute("aria-current")).toBe(false)
    expect(q(root, "table-head").querySelector("button")).toBeNull()
  })

  it("keeps a data-state set by hand", () => {
    const root = mount(() => h(Table, null, () => h(TableBody, null, () => h(TableRow, { "data-state": "selected" }, () => h(TableCell, null, () => "x")))))
    expect(q(root, "table-row").getAttribute("data-state")).toBe("selected")
  })

  it("makes heads and cells lower when compact, and fixes the layout", () => {
    const root = mount(() =>
      h(Table, { density: "compact", layout: "fixed" }, () => [
        h(TableHeader, null, () => h(TableRow, null, () => h(TableHead, null, () => "Item"))),
        h(TableBody, null, () => h(TableRow, null, () => h(TableCell, null, () => "Flour"))),
      ]),
    )
    expect(q(root, "table").classList.contains("table-fixed")).toBe(true)
    expect(q(root, "table").dataset.density).toBe("compact")
    expect(q(root, "table-head").classList.contains("h-7")).toBe(true)
    expect(q(root, "table-head").classList.contains("h-9")).toBe(false)
    expect(classes(q(root, "table-cell"))).toBe("align-middle px-2 py-1")
  })

  it("pins a sticky header with a line that does not scroll away, and sizes its box", () => {
    const root = mount(() => h(Table, { stickyHeader: true, containerClass: "max-h-80" }, () => h(TableHeader, null, () => h(TableRow, null, () => h(TableHead, null, () => "Item")))))
    const head = q(root, "table-header")
    expect(head.classList.contains("sticky")).toBe(true)
    expect(head.classList.contains("top-0")).toBe(true)
    expect(head.classList.contains("[&_tr]:border-b-0")).toBe(true)
    expect(q(root, "table-container").classList.contains("max-h-80")).toBe(true)
  })

  it("lines numbers up at the end", () => {
    const root = mount(() =>
      h(Table, null, () => [
        h(TableHeader, null, () => h(TableRow, null, () => h(TableHead, { align: "end", numeric: true }, () => "Time"))),
        h(TableBody, null, () => h(TableRow, null, () => h(TableCell, { align: "end", numeric: true }, () => "4:12"))),
      ]),
    )
    for (const el of [q(root, "table-head"), q(root, "table-cell")]) {
      expect(el.classList.contains("text-end")).toBe(true)
      expect(el.classList.contains("text-left")).toBe(false)
      expect(el.classList.contains("tabular-nums")).toBe(true)
      expect(el.hasAttribute("data-numeric")).toBe(true)
    }
  })

  it("shows the current row in the accent, says so, and gives it no hover", () => {
    const root = mount(() => h(Table, null, () => h(TableBody, null, () => h(TableRow, { current: true }, () => h(TableCell, null, () => "You")))))
    const row = q(root, "table-row")
    expect(row.getAttribute("aria-current")).toBe("true")
    expect(row.classList.contains("bg-accent/60")).toBe(true)
    expect(row.classList.contains("font-medium")).toBe(true)
    expect(row.classList.contains("hover:bg-muted/50")).toBe(false)
  })

  it("marks selected, toned and marked rows", () => {
    const root = mount(() =>
      h(Table, null, () =>
        h(TableBody, null, () => [
          h(TableRow, { selected: true }, () => h(TableCell, null, () => "a")),
          h(TableRow, { tone: "success", marked: true }, () => h(TableCell, null, () => "b")),
        ]),
      ),
    )
    const [selected, toned] = root.querySelectorAll("[data-slot=table-row]")
    expect(selected!.getAttribute("data-state")).toBe("selected")
    expect(toned!.getAttribute("data-tone")).toBe("success")
    expect(toned!.hasAttribute("data-marked")).toBe(true)
    expect(toned!.classList.contains("[&_[data-numeric]]:text-success")).toBe(true)
    expect(toned!.classList.contains("[&_[data-numeric]]:font-bold")).toBe(true)
  })

  it("reads the old tone names as success and destructive", () => {
    const root = mount(() =>
      h(Table, null, () =>
        h(TableBody, null, () => [
          h(TableRow, { tone: "positive" }, () => h(TableCell, null, () => "a")),
          h(TableRow, { tone: "negative" }, () => h(TableCell, null, () => "b")),
        ]),
      ),
    )
    const [better, worse] = root.querySelectorAll("[data-slot=table-row]")
    expect(better!.getAttribute("data-tone")).toBe("success")
    expect(better!.classList.contains("[&_[data-numeric]]:text-success")).toBe(true)
    expect(worse!.getAttribute("data-tone")).toBe("destructive")
    expect(worse!.classList.contains("[&_[data-numeric]]:text-destructive")).toBe(true)
  })

  it("spans group headings and notes across the table", () => {
    const root = mount(() =>
      h(Table, null, () =>
        h(TableBody, null, () => [h(TableGroup, { colspan: 3 }, () => "Defence"), h(TableRow, null, () => h(TableCell, null, () => "Life")), h(TableNote, { colspan: 3 }, () => "Gear only.")]),
      ),
    )
    const heading = q(root, "table-group").querySelector("th")!
    expect(heading.getAttribute("scope")).toBe("rowgroup")
    expect(heading.getAttribute("colspan")).toBe("3")
    expect(heading.textContent).toBe("Defence")
    expect(q(root, "table-note").querySelector("td")!.getAttribute("colspan")).toBe("3")
  })
})

describe("Table sort", () => {
  it("flips the sorted column and starts others at their first direction", () => {
    expect(nextSort(null, "time")).toEqual({ column: "time", direction: "ascending" })
    expect(nextSort({ column: "time", direction: "ascending" }, "time")).toEqual({ column: "time", direction: "descending" })
    expect(nextSort({ column: "time", direction: "descending" }, "time")).toEqual({ column: "time", direction: "ascending" })
    expect(nextSort({ column: "time", direction: "ascending" }, "score", "descending")).toEqual({ column: "score", direction: "descending" })
  })

  it("reports a press and shows aria-sort only on the sorted column", async () => {
    const sort = ref<TableSort | null>(null)
    const root = mount(() =>
      h(Table, { sort: sort.value, "onUpdate:sort": (next: TableSort | null | undefined) => (sort.value = next ?? null) }, () =>
        h(TableHeader, null, () =>
          h(TableRow, null, () => [h(TableHead, { sortKey: "name" }, () => "Name"), h(TableHead, { sortKey: "score", sortFirst: "descending" }, () => "Score"), h(TableHead, null, () => "Note")]),
        ),
      ),
    )
    const heads = () => [...root.querySelectorAll("[data-slot=table-head]")] as HTMLElement[]
    expect(heads().map((th) => th.getAttribute("aria-sort"))).toEqual([null, null, null])
    expect(heads()[2]!.querySelector("button")).toBeNull()

    heads()[0]!.querySelector("button")!.click()
    await nextTick()
    expect(sort.value).toEqual({ column: "name", direction: "ascending" })
    expect(heads().map((th) => th.getAttribute("aria-sort"))).toEqual(["ascending", null, null])

    heads()[0]!.querySelector("button")!.click()
    await nextTick()
    expect(heads()[0]!.getAttribute("aria-sort")).toBe("descending")

    heads()[1]!.querySelector("button")!.click()
    await nextTick()
    expect(sort.value).toEqual({ column: "score", direction: "descending" })
    expect(heads().map((th) => th.getAttribute("aria-sort"))).toEqual([null, "descending", null])
  })
})

describe("Table flush", () => {
  it("takes the padding off the outer edges only, and keeps a marked row's line off its text", () => {
    const root = mount(() => h(Table, { flush: true }, () => h(TableBody, null, () => h(TableRow, { marked: true }, () => h(TableCell, null, () => "Life")))))
    const table = q(root, "table")
    expect(table.className).toContain("[&_:is(th,td):first-child]:ps-0")
    expect(table.className).toContain("[&_:is(th,td):last-child]:pe-0")
    expect(table.className).toContain("[&_tr[data-marked]>:first-child]:ps-2")
  })
})
