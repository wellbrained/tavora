// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { ref } from "vue"
import { useReorderMotion } from "./use-reorder-motion"

/** A list of rows of 40 with gaps of 4 inside a scrolling parent: `scroll` moves the whole list up on screen, as the panel's scroller does. */
function list(scroll: { y: number }) {
  const el = document.createElement("div")
  el.getBoundingClientRect = () => ({ left: 0, top: 20 - scroll.y, width: 300, height: 176, right: 300, bottom: 196 - scroll.y, x: 0, y: 20 - scroll.y, toJSON() {} })
  for (const [n, id] of ["a", "b", "c", "d"].entries()) {
    const row = document.createElement("div")
    row.setAttribute("data-reorder-id", id)
    row.getBoundingClientRect = () => ({ left: 0, top: 20 + n * 44 - scroll.y, width: 300, height: 40, right: 300, bottom: 60 + n * 44 - scroll.y, x: 0, y: 20 + n * 44 - scroll.y, toJSON() {} })
    el.append(row)
  }
  return el
}

describe("useReorderMotion.over", () => {
  it("finds the place from the layout at the grab, also after an ancestor of the list scrolled mid-drag", () => {
    const scroll = { y: 0 }
    const reorder = useReorderMotion(ref(list(scroll)))
    reorder.begin("a")
    expect(reorder.over(10, 70)).toBeNull()
    // The panel scrolls 44 down while the pointer rests at 70: it is now over c's place in the list.
    scroll.y = 44
    expect(reorder.over(10, 70)).toEqual({ id: "c", after: false })
    scroll.y = 0
    expect(reorder.over(10, 70)).toBeNull()
  })
})

describe("useReorderMotion.drop", () => {
  it("leaves a drag that began while the drop waited for its list alone", async () => {
    const reorder = useReorderMotion(ref(list({ y: 0 })))
    reorder.begin("a")
    let finish!: () => void
    const dropping = reorder.drop(() => new Promise<void>((resolve) => (finish = resolve)))
    // Grabbed again before the owner changed the order.
    reorder.begin("b")
    finish()
    await dropping
    // The new drag still finds places; a reset by the old drop would have ended it.
    expect(reorder.over(10, 170)).toEqual({ id: "d", after: false })
  })
})
