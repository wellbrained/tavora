// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { createApp, h, nextTick, type App } from "vue"
import { Progress } from "."
import { setUiLanguage } from "../text"

let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ""
  setUiLanguage("en")
})

async function mount(props: Record<string, unknown>) {
  const root = document.createElement("div")
  document.body.append(root)
  app = createApp({ render: () => h(Progress, { "aria-label": "Download", ...props }) })
  app.mount(root)
  await nextTick()
  return {
    bar: root.querySelector<HTMLElement>("[data-slot=progress]")!,
    fill: root.querySelector<HTMLElement>("[data-slot=progress-indicator]")!,
  }
}

describe("Progress", () => {
  it("fills by the share of max, not by the raw value", async () => {
    const { fill } = await mount({ modelValue: 3, max: 4 })
    expect(fill.style.transform).toBe("translateX(-25%)")
  })

  it("keeps the fill and the spoken value inside the bar", async () => {
    const { bar, fill } = await mount({ modelValue: 150 })
    expect(fill.style.transform).toBe("translateX(-0%)")
    expect(bar.getAttribute("aria-valuenow")).toBe("100")
  })

  it("tells screen readers the percent in the user's language", async () => {
    setUiLanguage("de")
    const { bar } = await mount({ modelValue: 1, max: 4 })
    expect(bar.getAttribute("aria-valuetext")?.replace(/\s/g, " ")).toBe("25 %")
    expect(bar.getAttribute("aria-label")).toBe("Download")
  })
})
