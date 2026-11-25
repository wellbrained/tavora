import { describe, expect, it } from "vitest"
import { escapeCloses, isComposing } from "./keys"

describe("isComposing", () => {
  it("is true while an input method composes, also when only key code 229 tells", () => {
    expect(isComposing({ key: "Enter", isComposing: true })).toBe(true)
    expect(isComposing({ key: "Enter", isComposing: false, keyCode: 229 })).toBe(true)
    expect(isComposing({ key: "Process", isComposing: false })).toBe(true)
  })

  it("is false for a plain key", () => {
    expect(isComposing({ key: "Enter", isComposing: false, keyCode: 13 })).toBe(false)
    expect(isComposing({ key: "Escape", isComposing: false })).toBe(false)
  })
})

describe("escapeCloses", () => {
  const inside = (role: string | null) => ({ closest: (selector: string) => (role && selector.includes(role) ? {} : null) })
  const press = (init: { key?: string, isComposing?: boolean, keyCode?: number, defaultPrevented?: boolean, role?: string }) =>
    escapeCloses({ key: "Escape", isComposing: false, keyCode: 27, defaultPrevented: false, target: inside(init.role ?? null), ...init } as never)

  it("closes on a plain Escape", () => {
    expect(press({})).toBe(true)
  })

  it("leaves Escape to an input method that composes, to a handler that took it, and to an open list", () => {
    expect(press({ isComposing: true })).toBe(false)
    expect(press({ keyCode: 229 })).toBe(false)
    expect(press({ defaultPrevented: true })).toBe(false)
    expect(press({ role: "listbox" })).toBe(false)
    expect(press({ key: "Enter" })).toBe(false)
  })
})
