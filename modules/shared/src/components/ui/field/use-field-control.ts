// How a kit control joins the Field around it. Reka's Select and Checkbox read the Field themselves; the kit's Input,
// Textarea, NumberField, ComboboxInput and Switch call this and bind `attrs()` on the element that takes the focus.
import { injectFieldRootContext } from "reka-ui"
import { onBeforeUnmount, onMounted, useAttrs } from "vue"

type FieldContext = NonNullable<ReturnType<typeof injectFieldRootContext>>

// A Field has one control. The first kit control set up inside it takes it; any later one (a second field someone put
// in by mistake, an input inside a picker's popup) stays out, so two elements never share the label's id.
const taken = new WeakSet<FieldContext>()

export interface FieldControlOptions {
  /** The element that takes the focus, once mounted. The Field's label focuses it. */
  element: () => HTMLElement | null | undefined
  /** The control's value, so the Field knows whether it is filled. */
  value: () => unknown
  /** The id the control got as a prop. An `id` attribute is read on its own. */
  id?: () => string | undefined
  /** An off control is never marked invalid. Default: its `disabled` attribute. */
  disabled?: () => boolean | undefined
}

/** Space-separated ids, empty ones left out; `undefined` when there are none. */
export function joinIds(...ids: unknown[]): string | undefined {
  return ids.filter((id): id is string => typeof id === "string" && id.trim() !== "").join(" ") || undefined
}

/**
 * Call in `setup`. Inside a Field, `attrs()` gives the control its id (the label's `for`), `aria-labelledby`,
 * `aria-describedby` (the hint and, while it shows, the error) and `aria-invalid`, each merged with what the control
 * was given. Outside a Field, or when another control took the Field first, `attrs()` is empty.
 */
export function useFieldControl(options: FieldControlOptions) {
  const given = useAttrs()
  const found = injectFieldRootContext(null)
  const field = found && !taken.has(found) ? found : null
  if (field) taken.add(field)

  const off = options.disabled ?? (() => given.disabled !== undefined && given.disabled !== false && given.disabled !== "false")
  const id = () => options.id?.() ?? (given.id as string | undefined) ?? field?.fieldId.value

  let unregister: (() => void) | undefined
  onMounted(() => {
    unregister = field?.registerControl({ id, element: () => options.element() ?? undefined, getValue: options.value })
  })
  onBeforeUnmount(() => {
    unregister?.()
    if (field) taken.delete(field)
  })

  return {
    /** Whether this control is the one its Field labels. */
    inField: field !== null,
    /** The id the label points at; `undefined` outside a Field. */
    id: (): string | undefined => (field ? id() : undefined),
    attrs(): Record<string, unknown> {
      if (!field) return {}
      return {
        id: id(),
        "aria-labelledby": joinIds(given["aria-labelledby"], field.labelId.value),
        "aria-describedby": joinIds(given["aria-describedby"], field.describedBy.value),
        "aria-invalid": given["aria-invalid"] ?? (field.invalid.value && !off() ? "true" : undefined),
      }
    },
  }
}
