// @vitest-environment jsdom
// A button inside a <form> submits it unless it says otherwise. The kit's buttons that only close or clear must not:
// a Cancel in a dialog footer inside its form would otherwise save (docs/module-rules.md, Dialogs > Forms).
import { afterEach, describe, expect, it } from "vitest"
import { createApp, h, nextTick, ref, type App, type Component } from "vue"
import { SearchInput } from "../search-input"
import { DialogButton } from "."

let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.replaceChildren()
})

/** Mounts `render` inside a form and counts its submits. */
async function inForm(render: () => ReturnType<typeof h>) {
  const result = { submits: 0, root: document.createElement("div") }
  document.body.append(result.root)
  app = createApp({ render: () => h("form", { onSubmit: (event: Event) => (event.preventDefault(), result.submits++) }, [render()]) })
  app.mount(result.root)
  await nextTick()
  return result
}

const button = (component: Component, props: Record<string, unknown>, text: string) => h(component, props, () => text)

describe("buttons inside a form", () => {
  it("a close DialogButton does not submit", async () => {
    const form = await inForm(() => button(DialogButton, { close: true }, "Cancel"))
    const cancel = form.root.querySelector("button")!
    expect(cancel.getAttribute("type")).toBe("button")
    cancel.click()
    expect(form.submits).toBe(0)
  })

  it("an action DialogButton still submits, and a close one keeps a type it is given", async () => {
    const form = await inForm(() => h("div", [button(DialogButton, {}, "Save"), button(DialogButton, { close: true, type: "submit" }, "Done")]))
    const [save, done] = form.root.querySelectorAll("button")
    save!.click()
    done!.click()
    expect(form.submits).toBe(2)
  })

  it("the search field's clear button does not submit", async () => {
    const value = ref("lava")
    const form = await inForm(() => h(SearchInput, { modelValue: value.value, "onUpdate:modelValue": (next: string) => (value.value = next) }))
    const clear = form.root.querySelector<HTMLButtonElement>("[data-slot=search-input-clear]")!
    clear.click()
    await nextTick()
    expect(form.submits).toBe(0)
    expect(value.value).toBe("")
  })
})
