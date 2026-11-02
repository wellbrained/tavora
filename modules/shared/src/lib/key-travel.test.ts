import { describe, expect, it } from "vitest"
import { isTravelKey, useKeyTravel } from "./key-travel"

const key = (key: string, extra: Partial<KeyboardEvent> = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, ...extra }) as KeyboardEvent

describe("useKeyTravel", () => {
  it("counts the arrow keys, Home and End as travel, and Space and Enter as a choice", () => {
    for (const k of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"]) expect(isTravelKey(k)).toBe(true)
    for (const k of [" ", "Enter", "a", "Tab"]) expect(isTravelKey(k)).toBe(false)
  })

  it("holds from an arrow key press until the key goes up or a pointer presses", () => {
    const travel = useKeyTravel()
    travel.onKeydown(key("ArrowDown"))
    expect(travel.travelling.value).toBe(true)
    travel.end()
    expect(travel.travelling.value).toBe(false)
  })

  it("leaves Space and shortcuts alone", () => {
    const travel = useKeyTravel()
    travel.onKeydown(key(" "))
    travel.onKeydown(key("ArrowDown", { ctrlKey: true }))
    expect(travel.travelling.value).toBe(false)
  })
})
