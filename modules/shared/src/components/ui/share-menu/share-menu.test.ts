// @vitest-environment jsdom
import { createMemoryHost } from "@tavora/sdk/testing"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { createApp, defineComponent, h, ref, type App } from "vue"
import { setKitSdk } from "../../../kit-sdk"
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "../dropdown-menu"
import { setUiLanguage } from "../text"
import { toasts } from "../toast/toast"
import { ShareMenu, ShareMenuItems, ShareMenuSub, type ShareSource } from "."

const wait = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms))
const png = () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" })

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
})

let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ""
  toasts.value = []
  setKitSdk(undefined)
  setUiLanguage("en")
})

function mount(render: () => ReturnType<typeof h>) {
  const root = document.createElement("div")
  document.body.append(root)
  app = createApp(defineComponent({ render }))
  app.mount(root)
}

/** The entries in an open menu of the test's own. */
function openMenu(source: ShareSource) {
  const open = ref(true)
  mount(() =>
    h(DropdownMenu, { open: open.value, "onUpdate:open": (value: boolean) => (open.value = value), modal: false }, () => [
      h(DropdownMenuTrigger, null, () => "Menu"),
      h(DropdownMenuContent, null, () => [h(ShareMenuItems, source)]),
    ]),
  )
  return open
}

const rows = () => [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].map((el) => el.textContent?.trim())
const row = (testid: string) => document.querySelector<HTMLElement>(`[data-testid=${testid}]`)!
const titles = () => toasts.value.map((item) => item.title)

describe("ShareMenuItems", () => {
  it("shows Copy as text for text, and both picture entries for a picture", async () => {
    openMenu({ text: () => "hi" })
    await wait()
    expect(rows()).toEqual(["Copy as text"])
    app!.unmount()
    document.body.innerHTML = ""

    openMenu({ image: png })
    await wait()
    expect(rows()).toEqual(["Copy as image", "Save as image"])
  })

  it("speaks German, and takes its own words", async () => {
    setUiLanguage("de")
    openMenu({ text: () => "hi", image: png, labels: { saveImage: "Karte speichern" } } as ShareSource)
    await wait()
    expect(rows()).toEqual(["Als Text kopieren", "Als Bild kopieren", "Karte speichern"])
  })

  it("copies the text after a click and says so; without the click it says it couldn't", async () => {
    const { sdk, host } = createMemoryHost({ gestures: "enforce" })
    setKitSdk(sdk)
    const open = openMenu({ text: async () => "Solved on Hard" })
    await wait()
    await host.click(() => row("share-copy-text").click())
    await wait()
    expect(host.calls["clipboard.writeText"]).toEqual([{ text: "Solved on Hard" }])
    expect(titles()).toEqual(["Copied"])
    expect(open.value).toBe(false)

    open.value = true
    await wait()
    row("share-copy-text").click()
    await wait()
    expect(toasts.value.at(-1)).toMatchObject({ title: "Couldn't copy", description: "Try again.", variant: "error" })
  })

  it("makes the picture when the entries show, and copies it after a click", async () => {
    const { sdk, host } = createMemoryHost({ gestures: "enforce" })
    setKitSdk(sdk)
    const picture = png()
    const image = vi.fn(() => picture)
    openMenu({ image })
    await wait()
    expect(image).toHaveBeenCalledTimes(1)
    await host.click(() => row("share-copy-image").click())
    await wait()
    expect(image).toHaveBeenCalledTimes(1)
    expect(host.calls["clipboard.writeImage"]).toEqual([{ png: picture }])
    expect(titles()).toEqual(["Copied"])
  })

  it("saves the picture through Tavora's dialog with the name, and says nothing when the dialog is closed", async () => {
    const { sdk, host } = createMemoryHost()
    setKitSdk(sdk)
    const open = openMenu({ image: png, name: "Sudoku 2026-11-25" })
    await wait()
    row("share-save-image").click()
    await wait()
    expect(host.saved).toEqual([expect.objectContaining({ kind: "picture", fileName: "Sudoku 2026-11-25.png" })])
    expect(titles()).toEqual(["Saved as Sudoku 2026-11-25.png"])

    host.answer("pictures.save", () => null)
    open.value = true
    await wait()
    row("share-save-image").click()
    await wait()
    expect(titles()).toEqual(["Saved as Sudoku 2026-11-25.png"])
  })

  it("says it couldn't when the picture fails", async () => {
    const { sdk } = createMemoryHost()
    setKitSdk(sdk)
    openMenu({ image: () => Promise.reject(new Error("no canvas")) })
    await wait()
    row("share-copy-image").click()
    await wait()
    expect(toasts.value.at(-1)).toMatchObject({ title: "Couldn't copy", variant: "error" })
  })
})

describe("ShareMenu and ShareMenuSub", () => {
  it("ShareMenu is a Share button that opens the entries", async () => {
    mount(() => h(ShareMenu, { text: () => "hi" }))
    await wait()
    const button = row("share-menu")
    expect(button.textContent?.trim()).toBe("Share")
    expect(button.querySelector("svg")).not.toBeNull()
    button.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
    await wait()
    expect(rows()).toEqual(["Copy as text"])
  })

  it("puts its arrow after the word, and takes a look, a size, a class and a test id for its button", async () => {
    mount(() => h("div", [
      h(ShareMenu, { text: () => "hi" }),
      h(ShareMenu, { text: () => "hi", testid: "share-board", variant: "ghost", size: "sm", class: "ml-auto" }),
    ]))
    await wait()
    expect(row("share-menu").querySelector("svg")?.getAttribute("data-icon")).toBe("end")
    const second = row("share-board")
    expect(second.className).toContain("ml-auto")
    expect(second.className).toContain("h-[calc(var(--style-control-height,32px)-4px)]")
    expect(second.className).not.toContain("bg-secondary")
    expect(document.querySelectorAll("[data-testid=share-menu]")).toHaveLength(1)
  })

  it("ShareMenuSub is a Share row in a menu of your own", async () => {
    mount(() =>
      h(DropdownMenu, { open: true, modal: false }, () => [
        h(DropdownMenuTrigger, null, () => "More"),
        h(DropdownMenuContent, null, () => [h(ShareMenuSub, { image: png })]),
      ]),
    )
    await wait()
    expect(rows()).toEqual(["Share"])
  })
})
