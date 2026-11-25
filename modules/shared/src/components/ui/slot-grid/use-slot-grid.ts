// A board of slots the keyboard moves through (a deck, a kingdom, a puzzle board, a wall of tiles): one Tab stop, the arrow
// keys move between the slots, Home and End go to the ends of the row, Ctrl+Home and Ctrl+End to the first and last slot.
// It draws nothing of the slots themselves: bind `grid.root` on the board and `grid.slot(key)` on each slot, and keep
// your own markup, size and base look. A slot can be any element (a `div`): Enter and Space click it as they would a button. The kit adds the states: the chosen slot (a soft primary fill and edge), the
// keyboard focus (a ring inside the slot), hover and off.
//
// - `select: "focus"` (default): moving the focus picks the slot, as in a radio group (`radiogroup`, `radio`,
//   `aria-checked`). A click picks it too. `"none"`: the focus only moves; the board is a `group` and the slots' roles
//   are yours (Enter on a tile that places it, say).
// - Other keys stay yours: put your own `@keydown` on the board for digits, Delete or Escape, and read `focused` for the
//   slot they are for. The grid handles only the keys that move.
// - A slot that is off (`disabled` answers true, or why) is still reached and focused, so a keyboard user hears that it
//   is off and why; it can't be picked. A hole (`null` in `slots`) is skipped.
// - Tab into the board lands on the chosen slot, else the one used last, else the first (it only moves the focus there).
//   When the focused slot goes away, the focus moves to the slot now in its place, else the one before.
import { computed, getCurrentScope, nextTick, onScopeDispose, ref, shallowRef, toValue, watch, type MaybeRefOrGetter, type Ref } from "vue"
import { cn } from "../../../lib/utils"
import { stopSoft } from "../../../lib/soft-disabled"
import { REASON_ATTRIBUTE } from "../../../title-tooltips"
import { columnsFromBoxes, moveIndex, moveOf, recoverIndex } from "./moves"

export type SlotKey = string | number

export interface SlotGridOptions<K extends SlotKey> {
  /** The slots row by row; `null` is a hole (nothing there, the keys skip it). With `columns: "auto"` holes are left out. */
  slots: MaybeRefOrGetter<readonly (K | null)[]>
  /** Slots per row, or `"auto"` to read it from the page (tiles that wrap to the panel's width). */
  columns: MaybeRefOrGetter<number | "auto">
  /** The chosen slot (bind your own ref: it is changed when the user picks). Leave it out with `select: "none"`. */
  selected?: Ref<K | null>
  /** `"focus"` (default): moving the focus picks the slot. `"none"`: the focus only moves. */
  select?: "focus" | "none"
  /** The arrows start over at the other end instead of stopping at the edge. */
  wrap?: MaybeRefOrGetter<boolean>
  /** A slot that is off: `true`, or a short sentence saying why (it shows in the kit tooltip). */
  disabled?: (key: K) => boolean | string | null | undefined
}

export interface SlotGrid<K extends SlotKey> {
  /** Bind on the board: `v-bind="grid.root"` (its role, the keys, a ref). Give it an `aria-label` yourself. */
  readonly root: Record<string, unknown>
  /** Bind on each slot: `v-bind="grid.slot(key)"`. */
  slot(key: K): Record<string, unknown>
  /** The slot the keyboard is on (or was on last), for your own keys. */
  readonly focused: Readonly<Ref<K | null>>
  /** Moves the focus to a slot (and picks it, with `select: "focus"`). */
  focus(key: K): void
}

/** The states the kit draws on a slot; the slot's own classes give it its base look. */
const SLOT_CLASS = cn(
  "outline-none transition-[background-color,border-color,opacity] duration-(--duration-press) ease-(--ease-out-strong)",
  "focus-visible:inset-ring-2 focus-visible:inset-ring-ring",
  "[@media(hover:hover)]:not-data-selected:not-data-disabled:hover:bg-[color-mix(in_srgb,var(--foreground)_6%,transparent)]",
  "data-selected:border-solid data-selected:border-primary/55 data-selected:bg-primary/12",
  "data-disabled:opacity-(--disabled-opacity)",
)

let nextGrid = 1

export function useSlotGrid<K extends SlotKey>(options: SlotGridOptions<K>): SlotGrid<K> {
  const id = `slot-grid-${nextGrid++}`
  const mode = options.select ?? "focus"
  const selected = options.selected ?? ref(null) as Ref<K | null>
  const focused = shallowRef<K | null>(null) as Ref<K | null>
  let rootEl: HTMLElement | null = null

  const slots = computed(() => {
    const list = toValue(options.slots)
    return toValue(options.columns) === "auto" ? list.filter((slot) => slot != null) : list
  })
  const offOf = (key: K) => options.disabled?.(key) || false

  /** The slot that takes Tab: the chosen one, else the one used last, else the first. */
  const tabStop = computed<K | null>(() => {
    const list = slots.value
    if (selected.value != null && list.includes(selected.value)) return selected.value
    if (focused.value != null && list.includes(focused.value)) return focused.value
    return list.find((slot) => slot != null) ?? null
  })

  /** This grid's slot elements by key (a nested grid's are not its own). */
  function elements(): Map<string, HTMLElement> {
    const found = new Map<string, HTMLElement>()
    for (const el of rootEl?.querySelectorAll<HTMLElement>(`[data-slot-grid="${id}"]`) ?? []) found.set(el.dataset.slotKey ?? "", el)
    return found
  }
  const elementOf = (key: K) => elements().get(String(key)) ?? null

  function columns(): number {
    const value = toValue(options.columns)
    if (value !== "auto") return value
    const byKey = elements()
    return columnsFromBoxes(slots.value.map((key) => byKey.get(String(key))?.getBoundingClientRect().top ?? 0))
  }

  function pick(key: K) {
    if (mode !== "focus" || offOf(key)) return
    selected.value = key
  }

  function focus(key: K) {
    focused.value = key
    pick(key)
    elementOf(key)?.focus()
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.defaultPrevented) return
    const target = (event.target as Element | null)?.closest?.<HTMLElement>(`[data-slot-grid="${id}"]`)
    if (!target) return
    // A slot that is no button (a `div`) still takes Enter and Space as a click, as a button would; one that is off doesn't.
    if ((event.key === "Enter" || event.key === " ") && event.target === target && !target.matches("button, a[href]") && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      if (!event.repeat && !target.hasAttribute("data-disabled")) target.click()
      return
    }
    const move = moveOf(event)
    if (!move) return
    const list = slots.value
    const from = list.findIndex((slot) => slot != null && String(slot) === target.dataset.slotKey)
    if (from < 0) return
    event.preventDefault()
    const to = moveIndex(list, columns(), from, move, toValue(options.wrap) ?? false)
    if (to !== from) focus(list[to] as K)
  }

  // The focused slot went away while it had the focus: the slot now at its place takes it, else the one before. Read
  // before the page drops the slot (a pre-flush watcher), then focused once the new slots are drawn. A copy of the list,
  // so a slot taken out in place (splice) counts too. The choice stays as it is.
  watch(() => [...slots.value], (list, before) => {
    const gone = focused.value
    if (gone == null || list.includes(gone)) return
    const held = !!rootEl && rootEl.contains(document.activeElement)
    const at = recoverIndex(list, before.indexOf(gone))
    focused.value = at < 0 ? null : (list[at] as K)
    if (!held) return
    void nextTick(() => {
      const active = document.activeElement
      if (focused.value == null || !rootEl?.isConnected || (active && active !== document.body && !rootEl.contains(active))) return
      elementOf(focused.value)?.focus()
    })
  })

  if (getCurrentScope()) onScopeDispose(() => { rootEl = null })

  const root = {
    ref: (el: unknown) => { rootEl = el instanceof HTMLElement ? el : null },
    role: mode === "focus" ? "radiogroup" : "group",
    "data-slot": "slot-grid",
    onKeydown,
  }

  return {
    root,
    slot(key: K) {
      const off = offOf(key)
      const reason = typeof off === "string" ? off.trim() : ""
      const chosen = mode === "focus" && selected.value === key
      return {
        "data-slot-grid": id,
        "data-slot-key": String(key),
        tabindex: tabStop.value === key ? 0 : -1,
        ...(mode === "focus" ? { role: "radio", "aria-checked": chosen ? "true" : "false" } : {}),
        "data-selected": chosen ? "" : undefined,
        "data-disabled": off ? "" : undefined,
        "aria-disabled": off ? "true" : undefined,
        ...(reason ? { [REASON_ATTRIBUTE]: reason, "aria-description": reason } : {}),
        class: SLOT_CLASS,
        // Tab onto the board only moves the focus (as in a radio group); a click or an arrow key picks.
        onFocus: () => { focused.value = key },
        // A slot that is off takes no click: not the pick, not the page's own click handler.
        ...(off ? { onClickCapture: stopSoft } : {}),
        onClick: () => { focused.value = key; pick(key) },
      }
    },
    focused,
    focus,
  }
}
