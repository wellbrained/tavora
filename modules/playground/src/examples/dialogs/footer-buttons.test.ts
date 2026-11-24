// @vitest-environment jsdom
// The Footer buttons specimen: each dialog's Close or Cancel button really closes it.
import { afterEach, expect, it } from "vitest"
import { createApp, nextTick, type App } from "vue"
import FooterButtons from "./FooterButtons.vue"

let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.replaceChildren()
})

const settle = async () => {
  for (let step = 0; step < 4; step++) await nextTick()
}

it("closes the Action + Close dialog with its Close button", async () => {
  const host = document.createElement("div")
  document.body.append(host)
  app = createApp(FooterButtons)
  app.mount(host)
  const open = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Action + Close"))!
  open.click()
  await settle()
  const close = [...document.querySelectorAll<HTMLButtonElement>("[data-dialog-button=close]")].find((button) => button.textContent?.trim() === "Close")!
  expect(close).toBeTruthy()
  close.click()
  await settle()
  expect([...document.querySelectorAll("[role=dialog]")].filter((dialog) => dialog.getAttribute("data-state") === "open")).toHaveLength(0)
})
