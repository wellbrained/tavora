// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { createApp, defineComponent, h, nextTick, ref, type App } from "vue"
import { TemplateInput } from "."

let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ""
})

function mount(start: string, props: Record<string, unknown> = {}) {
  const text = ref(start)
  const field = ref<{ insert(value: string): Promise<void> } | null>(null)
  const root = document.createElement("div")
  document.body.append(root)
  app = createApp(
    defineComponent({
      render: () => h(TemplateInput, { ref: field, modelValue: text.value, "onUpdate:modelValue": (value: string) => (text.value = value), known: ["time"], ...props }),
    }),
  )
  app.mount(root)
  const marks = () => [...root.querySelectorAll("[data-mark]")].map((node) => [node.getAttribute("data-mark"), node.textContent])
  return { text, field, root, marks, input: () => root.querySelector("input") as HTMLInputElement }
}

describe("TemplateInput", () => {
  it("marks the placeholders it knows, underlines the others and leaves plain braces alone", () => {
    const { marks } = mount("Plank {Time} {oops} {{x}}")
    expect(marks()).toEqual([["plain", "Plank "], ["known", "{Time}"], ["plain", " "], ["unknown", "{oops}"], ["plain", " "], ["plain", "{{"], ["plain", "x"], ["plain", "}}"]])
  })

  it("gives its attributes to the input, and says a wrong text with aria-invalid", () => {
    const { input, root } = mount("", { id: "field", "aria-label": "Text", "data-testid": "text", invalid: true })
    expect(input().id).toBe("field")
    expect(input().getAttribute("aria-label")).toBe("Text")
    expect(input().dataset.testid).toBe("text")
    expect(input().getAttribute("aria-invalid")).toBe("true")
    expect(root.querySelector("[data-slot=template-input]")?.id).toBe("")
  })

  it("puts text where the cursor is, and the cursor after it", async () => {
    const { input, text, field } = mount("Plank left")
    input().setSelectionRange(5, 5)
    await field.value!.insert(" {time}")
    await nextTick()
    expect(text.value).toBe("Plank {time} left")
    expect(input().selectionStart).toBe(12)
  })
})
