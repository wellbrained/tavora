// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { createApp, h, nextTick, type App } from "vue"
import { Meter } from "."
import { setUiLanguage } from "../text"

let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ""
  setUiLanguage("en")
})

async function mount(props: Record<string, unknown>) {
  app?.unmount()
  document.body.innerHTML = ""
  const root = document.createElement("div")
  document.body.append(root)
  app = createApp({ render: () => h(Meter, { "aria-label": "Left", ...props }) })
  app.mount(root)
  await nextTick()
  return {
    bar: root.querySelector<HTMLElement>("[data-slot=meter]")!,
    fill: root.querySelector<HTMLElement>("[data-slot=meter-indicator]")!,
  }
}

const tone = async (props: Record<string, unknown>) => (await mount(props)).bar.dataset.tone

describe("Meter", () => {
  it("is a named meter with its value and scale, not a progress bar", async () => {
    const { bar } = await mount({ modelValue: 3, min: 1, max: 5 })
    expect(bar.getAttribute("role")).toBe("meter")
    expect(bar.getAttribute("aria-label")).toBe("Left")
    expect([bar.getAttribute("aria-valuemin"), bar.getAttribute("aria-valuenow"), bar.getAttribute("aria-valuemax")]).toEqual(["1", "3", "5"])
  })

  it("fills by the share of the scale", async () => {
    const { fill } = await mount({ modelValue: 3, min: 1, max: 5 })
    expect(fill.style.transform).toBe("translateX(-50%)")
  })

  it("keeps the fill and the spoken value on the scale", async () => {
    const over = await mount({ modelValue: 150 })
    expect(over.fill.style.transform).toMatch(/^translateX\(-?0%\)$/)
    expect(over.bar.getAttribute("aria-valuenow")).toBe("100")
    const odd = await mount({ modelValue: Number.NaN, min: 10, max: 10 })
    expect(odd.bar.getAttribute("aria-valuenow")).toBe("10")
    expect(odd.bar.getAttribute("aria-valuemax")).toBe("110")
  })

  it("says the percentage in the user's language, or the caller's words", async () => {
    setUiLanguage("de")
    const plain = await mount({ modelValue: 1, max: 4 })
    expect(plain.bar.getAttribute("aria-valuetext")?.replace(/\s/g, " ")).toBe("25 %")
    const worded = await mount({ modelValue: 40, valueText: "40 % left" })
    expect(worded.bar.getAttribute("aria-valuetext")).toBe("40 % left")
  })

  it("changes colour as an amount runs low", async () => {
    const limits = { tone: "success", warningUpTo: 30, destructiveUpTo: 10 }
    expect(await tone({ ...limits, modelValue: 31 })).toBe("success")
    expect(await tone({ ...limits, modelValue: 30 })).toBe("warning")
    expect(await tone({ ...limits, modelValue: 10 })).toBe("destructive")
  })

  it("changes colour as an amount fills up", async () => {
    const limits = { warningFrom: 70, destructiveFrom: 90 }
    expect(await tone({ ...limits, modelValue: 69 })).toBe("primary")
    expect(await tone({ ...limits, modelValue: 70 })).toBe("warning")
    const full = await mount({ ...limits, modelValue: 90 })
    expect(full.bar.dataset.tone).toBe("destructive")
    expect(full.fill.classList.contains("bg-destructive")).toBe(true)
  })

  it("takes a size, as tall as Progress by default", async () => {
    expect((await mount({})).bar.classList.contains("h-1.5")).toBe(true)
    expect((await mount({ size: "sm" })).bar.classList.contains("h-1")).toBe(true)
    expect((await mount({ size: "lg" })).bar.classList.contains("h-2")).toBe(true)
  })
})
