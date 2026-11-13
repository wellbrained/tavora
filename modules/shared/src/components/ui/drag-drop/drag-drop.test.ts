// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { nextTick } from "vue"
import { currentDrag, endDrag, startDrag, useDropTargets } from "./drag-drop"

/** A drag event as the browser sends it, with a data transfer that remembers what was set. */
function dragEvent(type: string, target: EventTarget, relatedTarget: EventTarget | null = null) {
  const data = new Map<string, string>()
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent
  Object.defineProperty(event, "currentTarget", { value: target })
  Object.defineProperty(event, "relatedTarget", { value: relatedTarget })
  Object.defineProperty(event, "dataTransfer", {
    value: { effectAllowed: "", dropEffect: "", setData: (k: string, v: string) => data.set(k, v), setDragImage: () => {}, types: () => [...data.keys()] },
  })
  return event
}

function source() {
  const el = document.createElement("div")
  document.body.append(el)
  return el
}

afterEach(() => endDrag())

describe("startDrag", () => {
  it("keeps the drag until the source ends it", () => {
    const el = source()
    startDrag(dragEvent("dragstart", el), "card", { id: "imp" })
    expect(currentDrag.value).toEqual({ kind: "card", payload: { id: "imp" } })
    el.dispatchEvent(new Event("dragend"))
    expect(currentDrag.value).toBeNull()
  })

  it("ends after a drop anywhere, also when the source is gone", async () => {
    const el = source()
    startDrag(dragEvent("dragstart", el), "card", "imp")
    el.remove()
    window.dispatchEvent(new Event("drop"))
    await new Promise((resolve) => setTimeout(resolve))
    expect(currentDrag.value).toBeNull()
  })
})

describe("useDropTargets", () => {
  it("shows the target that takes the drag and drops on it", async () => {
    const drop = vi.fn()
    const targets = useDropTargets<string>("card", { accepts: (card, key) => key !== "castle", drop })
    startDrag(dragEvent("dragstart", source()), "card", "imp")
    const plot = document.createElement("div")

    const over = dragEvent("dragover", plot)
    targets.target("a").onDragover(over)
    expect(over.defaultPrevented).toBe(true)
    expect(targets.over.value).toBe("a")

    const refused = dragEvent("dragover", plot)
    targets.target("castle").onDragover(refused)
    expect(refused.defaultPrevented).toBe(false)

    targets.target("a").onDrop(dragEvent("drop", plot))
    expect(drop).toHaveBeenCalledWith("imp", "a")
    expect(currentDrag.value).toBeNull()
    await nextTick()
    expect(targets.over.value).toBeNull()
  })

  it("ignores drags of another kind", () => {
    const targets = useDropTargets<string>("perk", { drop: vi.fn() })
    startDrag(dragEvent("dragstart", source()), "card", "imp")
    const over = dragEvent("dragover", document.createElement("div"))
    targets.target("a").onDragover(over)
    expect(over.defaultPrevented).toBe(false)
    expect(targets.dragged.value).toBeNull()
  })

  it("stays over a target while the pointer moves onto its child", () => {
    const targets = useDropTargets<string>("card", { drop: vi.fn() })
    startDrag(dragEvent("dragstart", source()), "card", "imp")
    const plot = document.createElement("div")
    const icon = document.createElement("img")
    plot.append(icon)
    targets.target("a").onDragover(dragEvent("dragover", plot))
    targets.target("a").onDragleave(dragEvent("dragleave", plot, icon))
    expect(targets.over.value).toBe("a")
    targets.target("a").onDragleave(dragEvent("dragleave", plot, document.body))
    expect(targets.over.value).toBeNull()
  })

  it("takes a drop next to the targets only when asked to", () => {
    const outside = vi.fn()
    const targets = useDropTargets<{ from?: string }>("card", { drop: vi.fn(), outside: { accepts: (card) => !!card.from, drop: outside } })
    const area = document.createElement("section")

    startDrag(dragEvent("dragstart", source()), "card", {})
    const fromPalette = dragEvent("dragover", area)
    targets.area.onDragover(fromPalette)
    expect(fromPalette.defaultPrevented).toBe(false)

    startDrag(dragEvent("dragstart", source()), "card", { from: "a" })
    const fromSlot = dragEvent("dragover", area)
    targets.area.onDragover(fromSlot)
    expect(fromSlot.defaultPrevented).toBe(true)
    targets.area.onDrop(dragEvent("drop", area))
    expect(outside).toHaveBeenCalledWith({ from: "a" })
  })
})
