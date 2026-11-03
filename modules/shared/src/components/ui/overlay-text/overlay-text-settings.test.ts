// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { createApp, defineComponent, h, nextTick, ref, type App } from "vue"
import { setUiLanguage } from "../text"
import { DEFAULT_OVERLAY_TEXT_BOX, type OverlayTextBoxSettings } from "./plan"
import { OverlayTextSettings } from "."

// The box's settings as one section of a module's settings: the rows show what the settings say, a fixed box shows more, and each
// control says only what it changed.

let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  setUiLanguage("en")
  document.body.innerHTML = ""
})

function mount(start: Partial<OverlayTextBoxSettings> = {}) {
  const value = ref<OverlayTextBoxSettings>({ ...DEFAULT_OVERLAY_TEXT_BOX, ...start })
  const changes: Partial<OverlayTextBoxSettings>[] = []
  const root = document.createElement("div")
  document.body.append(root)
  app = createApp(
    defineComponent({
      render: () =>
        h(OverlayTextSettings, {
          value: value.value,
          onChange: (change: Partial<OverlayTextBoxSettings>) => {
            changes.push(change)
            value.value = { ...value.value, ...change }
          },
        }),
    }),
  )
  app.mount(root)
  const testid = (id: string) => root.querySelector<HTMLElement>(`[data-testid="${id}"]`)
  return { value, changes, root, testid }
}

describe("OverlayTextSettings", () => {
  it("shows only the Size row while the box grows with the text, with a hint about scaling", () => {
    const { root, testid } = mount()
    expect(root.querySelector("h3")?.textContent).toBe("Box")
    // A section like the others of the page (its own data-slot), so a settings page lists it among them.
    expect(root.querySelector('[data-slot="settings-section"] h3')?.textContent).toBe("Box")
    expect(testid("box-grow")).not.toBeNull()
    expect(testid("too-long-scroll")).toBeNull()
    expect(root.textContent).toContain("Drag a corner on the Overlays page to scale it.")
  })

  it("shows Too long for a fixed box, and the speed, the pause and soft edges only for Scroll", async () => {
    const { root, testid, value } = mount({ box: "fixed" })
    expect(testid("too-long-scroll")).not.toBeNull()
    expect(testid("speed-normal")).not.toBeNull()
    expect(testid("pause")).not.toBeNull()
    expect(testid("soft-edges")).not.toBeNull()
    expect(root.textContent).toContain("Before each round, in seconds.")
    value.value = { ...value.value, tooLong: "shrink" }
    await nextTick()
    expect(testid("too-long-scroll")).not.toBeNull()
    expect(testid("speed-normal")).toBeNull()
    expect(testid("pause")).toBeNull()
  })

  it("says only what changed, so a module saves just that field", async () => {
    const { testid, changes } = mount({ box: "fixed" })
    testid("speed-fast")!.click()
    await nextTick()
    testid("too-long-cut")!.click()
    await nextTick()
    expect(changes).toEqual([{ speed: "fast" }, { tooLong: "cut" }])
  })

  it("switches the box between growing and fixed", async () => {
    const { testid, changes } = mount()
    testid("box-fixed")!.click()
    await nextTick()
    expect(changes).toEqual([{ box: "fixed" }])
    expect(testid("too-long-scroll")).not.toBeNull()
  })

  it("speaks German when the module does, with the pause written the German way", async () => {
    setUiLanguage("de")
    const { root, testid } = mount({ box: "fixed", pause: 0.5 })
    await nextTick()
    expect(root.querySelector("h3")?.textContent).toBe("Rahmen")
    expect(testid("box-grow")!.textContent).toContain("Wächst mit dem Text")
    expect(testid("pause")!.textContent).toContain("0,5")
  })
})
