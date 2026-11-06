import { useAttrs, watchPostEffect } from "vue"
import { REASON_ATTRIBUTE, SIDE_ATTRIBUTE } from "../title-tooltips"

/**
 * A switched-off control that can say why. A native `disabled` control gets no pointer events and no focus, so its tooltip
 * never shows and a keyboard or screen reader user can't reach the reason. With a reason (or, on a `Button`, a `title` or
 * `hinted`) it is `aria-disabled` instead: still hoverable and focusable, still announced as off, but it takes no click,
 * press or key that would use it. The reason shows in the kit tooltip beside the control and is its `aria-describedby`.
 */

/** Keys that press a button, open a menu or use a control. */
export const PRESS_KEYS: ReadonlySet<string> = new Set(["Enter", " ", "ArrowDown", "ArrowUp"])
/** The two keys that use a switch, a checkbox or a menu row; the arrows still move the focus on. */
export const ACTIVATE_KEYS: ReadonlySet<string> = new Set(["Enter", " "])
/** Everything but Tab, Escape and the modifiers: a closed select also reacts to letters, the arrows, Home and End. */
export const ANY_KEY = (event: KeyboardEvent): boolean =>
  !["Tab", "Escape", "Shift", "Control", "Alt", "Meta"].includes(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey

export interface SoftDisabledInput {
  disabled?: boolean
  /** Why it is off. */
  reason?: string
  /** A `Button` that has a hint of its own (a tooltip you show yourself). */
  hinted?: boolean
}

export interface SoftDisabledOptions {
  /** Which keys it takes no notice of. */
  keys?: ReadonlySet<string> | ((event: KeyboardEvent) => boolean)
  /** Set `data-disabled` while off. A menu row leaves it out: the menu skips rows that have it, and this one stays reachable. */
  dataDisabled?: boolean
  /** Stop the pointer going down too (default). A text field leaves it alone, so its text can still be selected and copied. */
  pointer?: boolean
  /** Where the reason opens when there is room. A menu row asks for `right`, so it does not cover the rows below. */
  side?: "left" | "right"
}

/** Off, and with something to say about it (a reason, or a title or `hinted` on a button). */
export function isSoftDisabled(input: SoftDisabledInput, title?: unknown): boolean {
  return !!input.disabled && (!!input.hinted || String(input.reason ?? "").trim() !== "" || String(title ?? "").trim() !== "")
}

/** Stops what the control would do: its own click handler, a menu trigger around it, a form submit. */
export function stopSoft(event: Event) {
  event.preventDefault()
  event.stopImmediatePropagation()
}

/**
 * For a control that takes a `disabledReason`. Call it in `setup`, put `inheritAttrs: false` on the component and bind
 * `soft.attrs()` on its root: that carries the attributes it was given plus, while it is off with a reason, the
 * handlers and attributes that make it soft. The root must not get a native `disabled` then: `soft.disabled` is what to pass
 * on instead (`undefined` while soft).
 */
export function useSoftDisabled(input: () => SoftDisabledInput, options: SoftDisabledOptions = {}) {
  const attrs = useAttrs()
  const keys = options.keys ?? PRESS_KEYS
  const takes = (event: KeyboardEvent) => (typeof keys === "function" ? keys(event) : keys.has(event.key))

  const soft = () => isSoftDisabled(input(), attrs.title)

  function stop(event: Event) {
    if (soft()) stopSoft(event)
  }
  function stopKey(event: KeyboardEvent) {
    if (soft() && takes(event)) stopSoft(event)
  }

  return {
    soft,
    /** What to give the control's own `disabled`: nothing while soft, since a native one can't be hovered or focused. */
    disabled: (): boolean | undefined => (soft() ? undefined : input().disabled || undefined),
    /** The attributes the control was given, and while it is soft the reason and the handlers that stop it being used. */
    attrs: (): Record<string, unknown> => {
      if (!soft()) return { ...attrs }
      const reason = String(input().reason ?? "").trim()
      return {
        ...attrs,
        "aria-disabled": "true",
        ...(options.dataDisabled === false ? {} : { "data-disabled": "" }),
        ...(reason ? { [REASON_ATTRIBUTE]: reason, "aria-description": reason } : {}),
        ...(reason && options.side ? { [SIDE_ATTRIBUTE]: options.side } : {}),
        onClickCapture: stop,
        ...(options.pointer === false ? {} : { onPointerdownCapture: stop, onMousedownCapture: stop }),
        onKeydownCapture: stopKey,
      }
    },
  }
}

/**
 * Puts `aria-disabled` on the element of a Reka part that sets (and so overrides) that attribute itself, a menu row.
 * A row that is soft is not told it is disabled, since Reka skips such rows, so the attribute is set here instead.
 * `element` is the part's template ref.
 */
export function useAriaDisabled(element: () => { $el?: unknown } | null | undefined, soft: () => boolean) {
  let marked: Element | null = null
  watchPostEffect(() => {
    const el = element()?.$el
    const on = soft()
    if (marked && (marked !== el || !on)) {
      marked.removeAttribute("aria-disabled")
      marked = null
    }
    if (on && el instanceof Element) {
      el.setAttribute("aria-disabled", "true")
      marked = el
    }
  })
}
