// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createApp, h, nextTick, type App } from "vue"
import { Copy } from "@lucide/vue"
import { Button } from "."
import { ACTION_TIMING, useButtonAction, type ButtonAction } from "./action"

const failed = vi.fn()
const announcer = () => document.querySelector('[data-slot="kit-announcer"]')?.textContent ?? ""

function setup(action: ButtonAction | undefined, doneText = "Copied") {
  return useButtonAction({ action: () => action, doneText: () => doneText, busyText: () => "Saving…", failed })
}

/** A Promise to settle by hand. */
function deferred<T = unknown>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.useFakeTimers()
  failed.mockReset()
})
afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ""
})

describe("useButtonAction", () => {
  it("an action that answers at once is done at once, with no busy step, then idle after 2 s", () => {
    const run = setup(() => undefined)
    run.press()
    expect(run.state.value).toEqual({ status: "done", round: 1 })
    vi.advanceTimersByTime(ACTION_TIMING.doneFor)
    expect(run.state.value.status).toBe("idle")
  })

  it("without a done label it goes straight back to idle", () => {
    const run = setup(() => undefined, "")
    run.press()
    expect(run.state.value.status).toBe("idle")
  })

  it("false means nothing happened: back to idle, no done, no failure", async () => {
    const run = setup(() => Promise.resolve(false))
    run.press()
    await vi.advanceTimersByTimeAsync(0)
    expect(run.state.value.status).toBe("idle")
    expect(failed).not.toHaveBeenCalled()
  })

  it("is busy and shows nothing for 300 ms, then a spinner, then the label at 1 s", async () => {
    const work = deferred()
    const run = setup(() => work.promise)
    run.press()
    expect(run.state.value).toEqual({ status: "busy", shows: "nothing" })
    vi.advanceTimersByTime(ACTION_TIMING.spinnerAfter)
    expect(run.state.value).toEqual({ status: "busy", shows: "spinner" })
    vi.advanceTimersByTime(ACTION_TIMING.labelAfter - ACTION_TIMING.spinnerAfter)
    expect(run.state.value).toEqual({ status: "busy", shows: "label" })
    vi.advanceTimersByTime(60)
    expect(announcer()).toBe("Saving…")
  })

  it("a quick Promise never shows the spinner", async () => {
    const run = setup(() => Promise.resolve())
    run.press()
    await vi.advanceTimersByTimeAsync(0)
    expect(run.state.value.status).toBe("done")
  })

  it("ignores a press while busy", () => {
    const action = vi.fn(() => deferred().promise)
    const run = setup(action)
    expect(run.press()).toBe(true)
    expect(run.press()).toBe(false)
    expect(action).toHaveBeenCalledTimes(1)
  })

  it("keeps a spinner that just appeared for at least 500 ms before saying it is done", async () => {
    const work = deferred()
    const run = setup(() => work.promise)
    run.press()
    vi.advanceTimersByTime(ACTION_TIMING.spinnerAfter + 100)
    work.resolve(undefined)
    await vi.advanceTimersByTimeAsync(0)
    expect(run.state.value.status).toBe("busy")
    await vi.advanceTimersByTimeAsync(ACTION_TIMING.shownAtLeast - 100)
    expect(run.state.value.status).toBe("done")
  })

  it("a failure goes back to idle and says why", async () => {
    const run = setup(() => Promise.reject(new Error("No press just before")))
    run.press()
    await vi.advanceTimersByTimeAsync(0)
    expect(run.state.value.status).toBe("idle")
    expect(failed).toHaveBeenCalledWith("No press just before")
  })

  it("a throw is a failure too", () => {
    const run = setup(() => {
      throw new Error("Nope")
    })
    run.press()
    expect(run.state.value.status).toBe("idle")
    expect(failed).toHaveBeenCalledWith("Nope")
  })

  it("a press while done runs again and starts the 2 s over", () => {
    const action = vi.fn()
    const run = setup(action)
    run.press()
    vi.advanceTimersByTime(1500)
    run.press()
    expect(action).toHaveBeenCalledTimes(2)
    expect(run.state.value).toEqual({ status: "done", round: 2 })
    vi.advanceTimersByTime(1500)
    expect(run.state.value.status).toBe("done")
    vi.advanceTimersByTime(500)
    expect(run.state.value.status).toBe("idle")
  })

  it("a press while done that takes a while is not cut short by the old 2 s", async () => {
    const work = deferred()
    let calls = 0
    const run = setup(() => (++calls === 1 ? undefined : work.promise))
    run.press()
    vi.advanceTimersByTime(1500)
    run.press()
    vi.advanceTimersByTime(1000)
    expect(run.state.value.status).toBe("busy")
  })

  it("says the done label to a screen reader", () => {
    setup(() => undefined).press()
    vi.advanceTimersByTime(60)
    expect(announcer()).toBe("Copied")
  })

  it("after dispose it changes nothing, but a failure is still told", async () => {
    const work = deferred()
    const run = setup(() => work.promise)
    run.press()
    run.dispose()
    work.reject(new Error("Gone"))
    await vi.advanceTimersByTimeAsync(0)
    expect(run.state.value.status).toBe("busy")
    expect(failed).toHaveBeenCalledWith("Gone")
  })
})

describe("Button with an action", () => {
  let app: App | undefined
  afterEach(() => {
    app?.unmount()
    app = undefined
  })

  function mount(props: Record<string, unknown>, content: () => unknown = () => [h(Copy), "Copy"]) {
    const host = document.createElement("div")
    document.body.append(host)
    app = createApp({ render: () => h(Button, props, { default: content }) })
    app.mount(host)
    // Vue ignores a click older than its listener; with the clock stopped they would be the same moment.
    vi.advanceTimersByTime(1)
    return host.querySelector("button") as HTMLButtonElement
  }

  it("leaves a button without an action as it was", () => {
    const button = mount({}, () => "Save")
    expect(button.innerHTML).toBe("Save")
    expect(button.hasAttribute("data-status")).toBe(false)
  })

  it("keeps its own name while it says Copied", async () => {
    const button = mount({ action: () => undefined, doneLabel: "Copied" })
    button.click()
    await nextTick()
    expect(button.dataset.status).toBe("done")
    // The name a screen reader reads is the button's own content; the done text is hidden from it.
    const read = button.cloneNode(true) as HTMLElement
    read.querySelectorAll('[aria-hidden="true"]').forEach((el) => el.remove())
    expect(read.textContent?.trim()).toBe("Copy")
    expect(button.querySelector('[data-label="Copied"]')?.getAttribute("aria-hidden")).toBe("true")
    expect(button.querySelector('[data-label="Copied"]')?.textContent).toContain("Copied")
  })

  it("is aria-busy and blocks the click for other listeners while busy", async () => {
    const onClick = vi.fn()
    const work = deferred()
    const button = mount({ action: () => work.promise, onClick })
    button.click()
    expect(onClick).toHaveBeenCalledTimes(1)
    await nextTick()
    expect(button.getAttribute("aria-busy")).toBe("true")
    expect(button.disabled).toBe(false)
    button.click()
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it("puts the spinner on the leading icon after 300 ms", async () => {
    const button = mount({ action: () => deferred().promise })
    button.click()
    vi.advanceTimersByTime(ACTION_TIMING.spinnerAfter)
    await nextTick()
    expect(button.querySelectorAll(".tavora-spin")).toHaveLength(1)
  })

  it("finds the leading icon behind Vue's comment anchors", async () => {
    const button = mount({ action: () => deferred().promise }, () => [null, h(Copy), "Copy"])
    button.click()
    vi.advanceTimersByTime(ACTION_TIMING.spinnerAfter)
    await nextTick()
    // The spinner sits on the icon (inside the button's own content), not over the hidden text.
    expect(button.querySelector('[data-label] .tavora-spin, :scope > span > span:not(:first-child) > .tavora-spin')).toBeNull()
    expect(button.querySelectorAll(".tavora-spin")).toHaveLength(1)
  })

  it("with as-child it runs the action but leaves the content as it is", () => {
    const action = vi.fn()
    const host = document.createElement("div")
    document.body.append(host)
    app = createApp({ render: () => h(Button, { asChild: true, action, doneLabel: "Copied" }, { default: () => h("a", { href: "#x" }, "Copy") }) })
    app.mount(host)
    vi.advanceTimersByTime(1)
    const link = host.querySelector("a") as HTMLAnchorElement
    expect(link.parentElement).toBe(host)
    expect(link.textContent).toBe("Copy")
    link.click()
    expect(action).toHaveBeenCalledTimes(1)
  })

  it("does not run when disabled", () => {
    const action = vi.fn()
    const button = mount({ action, disabled: true, disabledReason: "Nothing to copy" })
    button.click()
    expect(action).not.toHaveBeenCalled()
  })
})
