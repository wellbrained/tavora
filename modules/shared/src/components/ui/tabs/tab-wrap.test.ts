// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { createApp, h, type App } from "vue"
import { Tabs, TabsList, TabsTrigger } from "."
import { cn } from "../../../lib/utils"

let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ""
})

function mount(listClass: string) {
  const root = document.createElement("div")
  document.body.append(root)
  app = createApp({
    render: () => h(Tabs, { defaultValue: "a" }, () => [h(TabsList, { class: listClass }, () => h(TabsTrigger, { value: "a" }, () => "A"))]),
  })
  app.mount(root)
  const classes = (selector: string) => root.querySelector(selector)!.className.split(/\s+/)
  return { list: classes("[data-slot=tabs-list]"), tab: classes("[data-slot=tabs-trigger]") }
}

// jsdom lays nothing out: these are the rules that let a wrapped list grow instead of its tabs spilling over what follows.
describe("a list of tabs that wraps", () => {
  it("grows from one row, and each tab keeps a row's height", () => {
    const { list, tab } = mount("flex-wrap")
    expect(list).toContain("[&.flex-wrap]:h-auto")
    expect(list).toContain("[&.flex-wrap]:min-h-[var(--style-control-height,32px)]")
    expect(tab).toContain("group-[.flex-wrap]/tabs:h-auto")
    expect(tab).toContain("group-[.flex-wrap]/tabs:min-h-[calc(var(--style-control-height,32px)-1px)]")
  })

  it("leaves a list on one row at the control height, and a caller's own height in charge", () => {
    expect(mount("").list).toContain("h-[var(--style-control-height,32px)]")
    app!.unmount()
    expect(mount("h-10").list).toContain("h-10")
    expect(cn("h-[var(--style-control-height,32px)]", "h-10")).toBe("h-10")
  })
})
