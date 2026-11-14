// Where the focus goes when the row that has it goes away: deleted here or in another panel, folding away in its
// leaving motion, or taken out by a menu or dialog that had the focus meanwhile. Without this the browser drops the
// focus on the page's body and the keyboard has to start over. With it the focus moves to
//
// 1. the next row, at the same spot (the next row's ⋯ when you were on a ⋯), or its main control when the rows differ,
// 2. else the row before,
// 3. else the first control of the list's empty state (Add …), or the list itself.
//
// It never takes the focus from something else: a dialog, a menu, a field outside the list. A row that only moved (Alt+↑,
// a drag) or was drawn anew keeps the focus. It waits until the page has settled, so a component that puts the focus
// somewhere itself after a change (an editor opening in the row) wins. An optimistic delete is a row that goes and
// perhaps comes back: the going is handled like any delete; after Undo, or a delete that could not be saved and was
// put back, `restore(key)` gives the row the focus again once it is there.
//
// Mark the parts in the template; nothing else is needed:
//   data-focus-row="<id>"   on each row (a list inside a row is a list of its own: its rows are not the outer list's)
//   data-focus-target       on the control in a row that takes the focus when the rows differ (else its first control)
//   data-focus-empty        on the empty state, when it has a control to land on
import { unrefElement, type MaybeElementRef } from "@vueuse/core"
import { getCurrentScope, onScopeDispose } from "vue"

const ROW_ATTR = "data-focus-row"
const ROW = `[${ROW_ATTR}]`
const TARGET = "[data-focus-target]"
const EMPTY = "[data-focus-empty]"
const FOCUSABLE = "a[href], button, input:not([type='hidden']), select, textarea, [tabindex]:not([tabindex='-1']), [contenteditable]:not([contenteditable='false'])"
const TOASTER = "[data-slot='toaster-host']"
/** Layers that take the focus for a moment on the list's behalf (a row's menu, a confirm, the Undo toast): the list keeps its row. */
const LAYER = `[role='menu'], [role='dialog'], [role='alertdialog'], [role='listbox'], [data-reka-popper-content-wrapper], [data-tooltip-layer], ${TOASTER}`
/** How long `restore` waits for its row to come back. */
const RESTORE_MS = 3000

export interface FocusRecovery {
  /**
   * Gives the row with this key the focus once it is back (after Undo, or an optimistic delete that was put back). Only
   * when the focus has nowhere better to be: on the page, in this list or on the toast; it waits a few seconds at most.
   */
  restore(key: string): void
  /** Stops watching (done by itself when the component goes). */
  stop(): void
}

interface Hold {
  /** The row the focus is in; null when it is in the list but not in a row. */
  row: HTMLElement | null
  control: HTMLElement
  /** The control's place among the row's controls, to land on the same spot in a row like it. */
  spot: { index: number; count: number } | null
  /** The list's rows when last seen whole, in order; kept as they were once the row is gone (a gone row keeps its key). */
  rows: HTMLElement[]
  /** Outside a row: how many of those rows come before the control. */
  before: number
}

/** A row `restore` waits for, until its timer runs out. */
interface Awaited {
  key: string
  timer: ReturnType<typeof setTimeout>
}

interface Entry {
  list: () => HTMLElement | null
  hold: Hold | null
  awaited: Awaited | null
}

const entries = new Set<Entry>()
let observer: MutationObserver | null = null
let wired = false
let scheduled: ReturnType<typeof setTimeout> | undefined

// ── Reading the page ─────────────────────────────────────────────────

const visible = (el: HTMLElement) => (typeof el.checkVisibility === "function" ? el.checkVisibility() : true)

/** Can take the focus now: there, not switched off, not inert, not hidden. */
function usable(el: HTMLElement): boolean {
  return el.isConnected && !(el as HTMLButtonElement).disabled && !el.closest("[inert]") && visible(el)
}

function listsNow(): Set<HTMLElement> {
  const lists = new Set<HTMLElement>()
  for (const entry of entries) {
    const list = entry.list()
    if (list) lists.add(list)
  }
  return lists
}

/** The nearest list around an element (not the element itself). */
function ownerOf(el: Element, lists: Set<HTMLElement>): HTMLElement | null {
  for (let at = el.parentElement; at; at = at.parentElement) if (lists.has(at)) return at
  return null
}

function rowsOf(list: HTMLElement, lists: Set<HTMLElement>): HTMLElement[] {
  return Array.from(list.querySelectorAll<HTMLElement>(ROW)).filter((row) => ownerOf(row, lists) === list)
}

function rowAround(list: HTMLElement, node: Element, lists: Set<HTMLElement>): HTMLElement | null {
  for (let at: Element | null = node; at && at !== list; at = at.parentElement) {
    if (at.hasAttribute(ROW_ATTR) && ownerOf(at, lists) === list) return at as HTMLElement
  }
  return null
}

const keyOf = (row: HTMLElement) => row.getAttribute(ROW_ATTR) ?? ""

function controlsOf(el: HTMLElement): HTMLElement[] {
  const found = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE))
  if (el.matches(FOCUSABLE)) found.unshift(el)
  return found.filter(usable)
}

/** The row's control for the focus: the same spot as before in a row like it, else its target, else its first. */
function controlIn(row: HTMLElement, spot: Hold["spot"]): HTMLElement {
  const controls = controlsOf(row)
  if (spot && controls.length === spot.count) return controls[spot.index]!
  const target = row.matches(TARGET) ? row : row.querySelector<HTMLElement>(TARGET)
  if (target && usable(target)) return target
  return controls[0] ?? row
}

/** Focuses an element; one that is not a control takes the focus for as long as it keeps it. */
function focusOn(el: HTMLElement) {
  const lent = !el.matches(FOCUSABLE) && !el.hasAttribute("tabindex")
  if (lent) el.setAttribute("tabindex", "-1")
  el.focus()
  if (!lent) return
  if (document.activeElement === el) el.addEventListener("blur", () => el.removeAttribute("tabindex"), { once: true })
  else el.removeAttribute("tabindex")
}

/** The focus fell off: to the body, with an element that left the page, or into a row of this list that is leaving. */
function lost(active: Element | null, list: HTMLElement): boolean {
  if (!active || active === document.body || active === document.documentElement || !active.isConnected) return true
  const inert = active.closest("[inert]")
  return !!inert && inert !== list && list.contains(inert)
}

/** In a layer over the list (not one the list itself sits in, such as the Settings dialog). */
function inLayer(el: Element, list: HTMLElement | null): boolean {
  const layer = el.closest(LAYER)
  return !!layer && !layer.contains(list)
}

function depth(el: Element): number {
  let count = 0
  for (let at = el.parentElement; at; at = at.parentElement) count++
  return count
}

// ── Holding and moving the focus ─────────────────────────────────────

/** Takes in the list's rows as they are now. */
function readRows(hold: Hold, list: HTMLElement, lists: Set<HTMLElement>) {
  hold.rows = rowsOf(list, lists)
  if (!hold.row) hold.before = hold.rows.filter((row) => row.compareDocumentPosition(hold.control) & Node.DOCUMENT_POSITION_FOLLOWING).length
}

function holdFor(list: HTMLElement, control: HTMLElement, lists: Set<HTMLElement>): Hold {
  const row = rowAround(list, control, lists)
  const controls = row ? controlsOf(row) : []
  const index = controls.indexOf(control)
  const hold: Hold = { row, control, spot: index >= 0 ? { index, count: controls.length } : null, rows: [], before: 0 }
  readRows(hold, list, lists)
  return hold
}

/** Where the focus goes now that it fell off the held row. */
function landing(hold: Hold, list: HTMLElement, lists: Set<HTMLElement>): HTMLElement {
  // Still there (its row moved, or the page dropped the focus): it keeps it.
  if (list.contains(hold.control) && usable(hold.control)) return hold.control
  const rows = rowsOf(list, lists).filter(usable)
  /** The row as it is now: the same element, or one drawn anew with its key. */
  const now = (seen: HTMLElement) => {
    const key = keyOf(seen)
    return key ? rows.find((row) => keyOf(row) === key) : rows.includes(seen) ? seen : undefined
  }
  /** The first row still there, walking the rows as they were from `from` by `step`. */
  const firstLeft = (from: number, step: 1 | -1) => {
    for (let i = from; i >= 0 && i < hold.rows.length; i += step) {
      const row = now(hold.rows[i]!)
      if (row) return row
    }
    return undefined
  }
  if (hold.row) {
    // The same row drawn anew, else the next, else the one before.
    const at = hold.rows.indexOf(hold.row)
    const row = at >= 0 ? (firstLeft(at, 1) ?? firstLeft(at - 1, -1)) : (now(hold.row) ?? rows[0])
    if (row) return controlIn(row, hold.spot)
  } else {
    // A control between the rows (a field for a new row, say) went: the row before it, else the one after.
    const row = firstLeft(Math.min(hold.before, hold.rows.length) - 1, -1) ?? firstLeft(hold.before, 1)
    if (row) return controlIn(row, null)
  }
  // No row left: the empty state's first control (Add …), else the list itself.
  const empty = Array.from(list.querySelectorAll<HTMLElement>(EMPTY)).find((el) => ownerOf(el, lists) === list)
  return (empty && usable(empty) && controlsOf(empty)[0]) || list
}

/** Runs once the page has settled after a change, while a list holds a row or waits for one: moves the focus where it fell off. */
function check() {
  scheduled = undefined
  const lists = new Set<HTMLElement>()
  const live: { entry: Entry; list: HTMLElement }[] = []
  for (const entry of entries) {
    const list = entry.list()
    if (list) lists.add(list)
    if (!list?.isConnected) entry.hold = null
    else if (entry.hold || entry.awaited) live.push({ entry, list })
  }
  // A list inside another goes first: its row is the nearer one.
  live.sort((a, b) => depth(b.list) - depth(a.list))
  for (const { entry, list } of live) {
    const awaited = entry.awaited
    if (awaited) {
      const active = document.activeElement
      const row = rowsOf(list, lists).find((el) => keyOf(el) === awaited.key && usable(el))
      if (row && (lost(active, list) || list.contains(active) || !!active?.closest(TOASTER))) {
        endAwaited(entry)
        focusOn(controlIn(row, null))
        continue
      }
    }
    const hold = entry.hold
    if (!hold) continue
    // Behind an open dialog the list waits; the dialog closing (its inert going) brings it back here.
    if (list.closest("[inert]")) continue
    if (lost(document.activeElement, list)) {
      entry.hold = null
      focusOn(landing(hold, list, lists))
    } else if (hold.row ? list.contains(hold.row) && !hold.row.closest("[inert]") : list.contains(hold.control)) {
      // Kept up to date while the row is there; once it is gone, the rows as they were tell its neighbours.
      readRows(hold, list, lists)
    }
  }
  sync()
}

/** Looks once the page has settled: after Vue's render and whatever its components do with the focus right after. */
function schedule() {
  scheduled ??= setTimeout(check, 0)
}

function endAwaited(entry: Entry) {
  if (entry.awaited) clearTimeout(entry.awaited.timer)
  entry.awaited = null
}

// ── Listening ────────────────────────────────────────────────────────

function onFocusIn(event: FocusEvent) {
  const target = event.target
  if (!(target instanceof HTMLElement)) return
  const lists = listsNow()
  for (const entry of entries) {
    const list = entry.list()
    if (list?.contains(target)) {
      entry.hold = holdFor(list, target, lists)
      if (entry.awaited && (!entry.hold.row || keyOf(entry.hold.row) !== entry.awaited.key)) endAwaited(entry)
    } else if (!inLayer(target, list)) {
      entry.hold = null
      endAwaited(entry)
    }
  }
  sync()
}

/** The focus went nowhere (no new element): look once the page has settled, in case it fell off without a change to the page. */
function onFocusOut(event: FocusEvent) {
  if (event.relatedTarget === null) schedule()
}

/**
 * A press that doesn't land on a control lets go of the held row: what the user does there is theirs, even if it drops
 * the focus (a click beside a field to leave it). A press on a control moves the focus there anyway.
 */
function onPointerDown(event: PointerEvent) {
  const target = event.target instanceof Element ? event.target : null
  if (!target) return
  for (const entry of entries) {
    const list = entry.list()
    if (inLayer(target, list)) continue
    if (entry.hold && !(list?.contains(target) && target.closest(FOCUSABLE))) entry.hold = null
    if (entry.awaited && !list?.contains(target)) endAwaited(entry)
  }
  sync()
}

/** Watches the page only while a list holds a row or waits for one. */
function sync() {
  const needed = [...entries].some((entry) => entry.hold || entry.awaited)
  if (needed && !observer) {
    observer = new MutationObserver(schedule)
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["inert"] })
  } else if (!needed && observer) {
    observer.disconnect()
    observer = null
  }
}

function wire(on: boolean) {
  if (on === wired) return
  wired = on
  if (on) {
    document.addEventListener("focusin", onFocusIn, true)
    document.addEventListener("focusout", onFocusOut, true)
    document.addEventListener("pointerdown", onPointerDown, true)
  } else {
    document.removeEventListener("focusin", onFocusIn, true)
    document.removeEventListener("focusout", onFocusOut, true)
    document.removeEventListener("pointerdown", onPointerDown, true)
    clearTimeout(scheduled)
    scheduled = undefined
  }
}

/** Watches a list without Vue. `list` is read each time, so it may come and go. */
export function createFocusRecovery(list: () => HTMLElement | null): FocusRecovery {
  if (typeof document === "undefined") return { restore() {}, stop() {} }
  const entry: Entry = { list, hold: null, awaited: null }
  entries.add(entry)
  wire(true)
  // The list may already have the focus (a component made while its list was focused).
  const active = document.activeElement
  const now = list()
  if (active instanceof HTMLElement && now?.contains(active)) entry.hold = holdFor(now, active, listsNow())
  sync()
  return {
    restore(key) {
      if (!entries.has(entry)) return
      endAwaited(entry)
      const timer = setTimeout(() => {
        endAwaited(entry)
        sync()
      }, RESTORE_MS)
      entry.awaited = { key, timer }
      check()
    },
    stop() {
      if (!entries.delete(entry)) return
      endAwaited(entry)
      if (!entries.size) wire(false)
      sync()
    },
  }
}

/**
 * Keeps the focus in a list when its focused row goes: to the next row, else the one before, else the empty state or the
 * list. Mark rows `data-focus-row="<id>"` (see the top of this file); call `restore(id)` after Undo.
 */
export function useFocusRecovery(list: MaybeElementRef): FocusRecovery {
  const recovery = createFocusRecovery(() => (unrefElement(list) as HTMLElement | null | undefined) ?? null)
  if (getCurrentScope()) onScopeDispose(recovery.stop)
  return recovery
}
