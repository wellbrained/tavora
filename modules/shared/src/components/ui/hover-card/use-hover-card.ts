// The behaviour behind a HoverCard: a card you can move into, click in and pin. It opens after a wait on hover (none
// while you go along a row of them), at once when the keyboard reaches its target, and stays while the pointer is on
// the target or the card. Tab goes from the target into the card and on past it; Escape closes it and gives the focus
// back to the target. While the focus is in the card (or in a menu opened from it) it stays when the pointer leaves; a
// pinnable card pins when you click a target that isn't a control (on touch, a tap pins any such target), and then
// shows its close button.
//
// One card for many targets, the way `useTooltip` does it:
//
//   const card = useHoverCard<Spell>({ pinnable: true })
//   <span v-for="spell in spells" v-bind="card.on(spell, { focusable: true })">…</span>
//   <HoverCard v-bind="card.props"><HoverCardContent :title="card.content?.name">…</HoverCardContent></HoverCard>
//
// A single target needs none of this: `<HoverCard><HoverCardTrigger>` makes its own.
import { getCurrentScope, onScopeDispose, reactive, shallowRef, type VNode } from "vue"
import { CONTROLS, keyboardFocus, watchInput } from "../../tooltip/use-tooltip"
import type { TooltipCard, TooltipTargetOptions } from "../../tooltip/use-tooltip"
import type { TooltipSide } from "../../tooltip/geometry"

/**
 * Where the card is, as one value: none, waiting for the hover delay, open (it closes when you leave, unless the focus
 * is in it), `leaving` (the pointer left; it closes after `closeDelay` unless it comes back) or `pinned` (it stays until
 * you close it).
 */
export type HoverCardStatus = "closed" | "waiting" | "open" | "leaving" | "pinned"

export interface UseHoverCardOptions {
  /** The wait before the first card opens on hover, in ms. 400 by default. */
  openDelay?: number
  /** How long the card stays after the pointer leaves, so you can move onto it, in ms. 200 by default. */
  closeDelay?: number
  /** A click on a target that isn't a control (a name, a picture) pins its card, with a close button. Off by default. */
  pinnable?: boolean
  /** Where the card goes when there is room. A target can ask for another side. */
  side?: TooltipSide
}

export interface HoverCardCloseOptions {
  /** Put the focus back on the target (Escape and the close button do). */
  returnFocus?: boolean
}

export interface UseHoverCard<T> {
  /** Bind on each target: `v-bind="card.on(item)"`. */
  on(card: TooltipCard<T>, options?: TooltipTargetOptions): Record<string, unknown>
  /** Bind on the HoverCard: `<HoverCard v-bind="card.props">`. */
  readonly props: { controller: UseHoverCard<T> }
  /** The card shown now (or the last one): fill the HoverCardContent from it. */
  readonly content: T | null
  readonly status: HoverCardStatus
  /** The card is on the screen (open, leaving or pinned). */
  readonly open: boolean
  readonly pinned: boolean
  /** The element the card is for. */
  readonly target: Element | null
  /** Where the card goes now. */
  readonly side: TooltipSide
  /** The card's id: the target points at it with `aria-controls`. */
  readonly id: string
  /** Shows a card for an element at once, as from the keyboard; `pinned` pins it. */
  show(element: Element, card: TooltipCard<T>, options?: TooltipTargetOptions & { pinned?: boolean }): void
  /** Pins the card that is open now. */
  pin(): void
  /** Closes the card, and cancels one that is still waiting. */
  close(options?: HoverCardCloseOptions): void
  /** For HoverCardContent: the card's own element and events. */
  readonly surface: HoverCardSurface
}

/** What HoverCardContent tells the helper. Not for modules. */
export interface HoverCardSurface {
  attach(element: HTMLElement | null): void
  readonly element: HTMLElement | null
  /** Escape, a press outside, the focus going outside: true when the card goes, false to keep it. */
  dismiss(reason: "escape" | "outside-press" | "focus-outside", target: EventTarget | null): boolean
}

const OPEN_DELAY = 400
const CLOSE_DELAY = 200
/** After a card closes, the next one this soon opens without waiting, as along a row of targets. */
const HOVER_CARD_WARM_MS = 400
let lastClosed = -Infinity
let instances = 0

const TABBABLE = 'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), summary, [contenteditable=""], [contenteditable=true], [tabindex]'

/** The elements Tab stops at inside `root`, in order. */
function tabbables(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter(element =>
    element.tabIndex >= 0 && !element.closest("[inert]") && !element.hidden && element.getAttribute("aria-hidden") !== "true")
}

const resolve = <T>(card: TooltipCard<T>): T | null => (typeof card === "function" ? (card as () => T | null | undefined)() : card) ?? null

export function useHoverCard<T = unknown>(options: UseHoverCardOptions = {}): UseHoverCard<T> {
  const id = `tavora-hover-card-${++instances}`
  if (typeof document !== "undefined") watchInput(document)
  const state = reactive({ status: "closed" as HoverCardStatus, side: (options.side ?? "bottom") as TooltipSide })
  const shown = shallowRef<TooltipCard<T>>(null)
  const current = shallowRef<Element | null>(null)
  let cardElement: HTMLElement | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  /** How the last press started: a tap pins on touch, where there is no hover. */
  let pointerType = ""
  let observer: IntersectionObserver | undefined
  /** The focus is going back to the target as the card closes. */
  let returning = false

  const isOpen = () => state.status === "open" || state.status === "leaving" || state.status === "pinned"
  const stay = () => state.status === "pinned"
  /**
   * The focus is in the card, or in a menu or select opened from it (a layer of its own on top): the card stays when the
   * pointer leaves, and goes when the focus does.
   */
  function focusInside() {
    const active = document.activeElement
    if (!active || active === document.body || !cardElement) return false
    if (cardElement.contains(active)) return true
    const layer = active.closest("[data-dismissable-layer]")
    return Boolean(layer && layer !== cardElement && !layer.contains(cardElement))
  }

  function clearTimer() {
    clearTimeout(timer)
    timer = undefined
  }

  /** The target says which card it controls while the card is open; a button or link also says it is expanded. */
  function mark(element: Element | null, on: boolean) {
    if (!element) return
    if (on) element.setAttribute("aria-controls", id)
    else if (element.getAttribute("aria-controls") === id) element.removeAttribute("aria-controls")
    if (element.matches(CONTROLS)) {
      if (on) element.setAttribute("aria-expanded", "true")
      else element.removeAttribute("aria-expanded")
    }
  }

  /** A pinned card follows its target as the panel scrolls, and closes once the target is scrolled out of sight. */
  function watchTarget(element: Element | null) {
    observer?.disconnect()
    observer = undefined
    if (!element || typeof IntersectionObserver === "undefined") return
    observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.target === current.value && !entry.isIntersecting) && stay()) close()
    })
    observer.observe(element)
  }

  function onWindowChange(event: Event) {
    // Scrolling inside the card doesn't move it; a pinned card follows its target instead.
    if (event.type === "scroll" && cardElement && event.target instanceof Node && cardElement.contains(event.target)) return
    if (!stay()) close()
  }
  let listening = false
  function listen(on: boolean) {
    if (on === listening || typeof window === "undefined") return
    listening = on
    const change = on ? window.addEventListener.bind(window) : window.removeEventListener.bind(window)
    change("scroll", onWindowChange, true)
    change("resize", onWindowChange)
    change("blur", onWindowChange)
  }

  function setStatus(next: HoverCardStatus) {
    const wasOpen = isOpen()
    state.status = next
    const open = isOpen()
    if (wasOpen && !open) lastClosed = performance.now()
    listen(open)
    if (open !== wasOpen) mark(current.value, open)
    if (next === "pinned") watchTarget(current.value)
    else if (!open) watchTarget(null)
  }

  function close(closeOptions: HoverCardCloseOptions = {}) {
    clearTimer()
    const target = current.value
    // The focus goes back only from the card or the target itself: never pulled away from where you went.
    const focusHere = Boolean(closeOptions.returnFocus && target instanceof HTMLElement
      && (target.contains(document.activeElement) || cardElement?.contains(document.activeElement)))
    setStatus("closed")
    if (!focusHere) return
    const element = target as HTMLElement
    // A target that can't take the focus by itself (a name, a picture) takes it from a script, so it isn't lost.
    if (element.tabIndex < 0 && !element.hasAttribute("tabindex")) element.setAttribute("tabindex", "-1")
    // The focus coming back isn't a reason to open the card again.
    returning = true
    try { element.focus() } finally { returning = false }
  }

  /** Opens the card for `element` now, moving it from another target if one had it. */
  function openFor(element: Element, card: TooltipCard<T>, side: TooltipSide | undefined, next: "open" | "pinned") {
    clearTimer()
    if (resolve(card) === null || !element.isConnected) return close()
    if (current.value !== element) {
      if (isOpen()) mark(current.value, false)
      current.value = element
      if (isOpen()) mark(element, true)
    }
    shown.value = card
    state.side = side ?? options.side ?? "bottom"
    setStatus(next)
  }

  function hoverWait() {
    return performance.now() - lastClosed < HOVER_CARD_WARM_MS ? 0 : (options.openDelay ?? OPEN_DELAY)
  }

  function enter(element: Element, card: TooltipCard<T>, target: TooltipTargetOptions) {
    // A pinned card stays as it is: hovering other targets opens nothing.
    if (stay()) return
    if (element === current.value && (state.status === "open" || state.status === "leaving")) return stayOpen()
    if (element === current.value && state.status === "waiting") return
    if (resolve(card) === null) return
    // Another card is open: the next one comes at once.
    if (isOpen()) return openFor(element, card, target.side, "open")
    clearTimer()
    current.value = element
    shown.value = card
    const wait = hoverWait()
    if (wait <= 0) return openFor(element, card, target.side, "open")
    setStatus("waiting")
    timer = setTimeout(() => openFor(element, card, target.side, "open"), wait)
  }

  /** The pointer came back before the card went. */
  function stayOpen() {
    clearTimer()
    setStatus("open")
  }

  function leave() {
    if (state.status === "waiting") return close()
    if (state.status !== "open" || focusInside()) return
    setStatus("leaving")
    clearTimer()
    timer = setTimeout(() => close(), options.closeDelay ?? CLOSE_DELAY)
  }

  function pin() {
    if (isOpen()) setStatus("pinned")
  }

  /** A click (or a tap) on a target. */
  function press(element: Element, card: TooltipCard<T>, target: TooltipTargetOptions) {
    // Buttons, links and menu rows only do what they do.
    if (element.closest(CONTROLS)) return
    if (!options.pinnable && pointerType !== "touch") return
    // Clicking the pinned target again closes its card.
    if (state.status === "pinned" && current.value === element) return close()
    openFor(element, card, target.side, "pinned")
  }

  /** The first stop after `element` in the page's Tab order, outside the card. */
  function nextAfter(element: Element): HTMLElement | undefined {
    return tabbables(document).find(candidate => !cardElement?.contains(candidate) && !element.contains(candidate)
      && Boolean(element.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING))
  }

  /** Tab from the target goes into the open card, to its first stop. */
  function targetKey(event: KeyboardEvent) {
    if (event.currentTarget !== current.value || !isOpen()) return
    if (event.key === "Escape") {
      event.preventDefault()
      return close({ returnFocus: true })
    }
    if (event.key !== "Tab" || event.shiftKey || !cardElement) return
    const first = tabbables(cardElement)[0]
    if (!first) return
    event.preventDefault()
    first.focus()
  }

  /** Tab past the card's last stop goes on after the target; Shift+Tab from its first goes back to the target. */
  function cardKey(event: KeyboardEvent) {
    // Escape comes through Reka's layer (dismiss below), which gives it to a menu opened from the card first.
    if (event.key !== "Tab" || !cardElement || !(current.value instanceof HTMLElement)) return
    const stops = tabbables(cardElement)
    const target = current.value
    if (event.shiftKey && document.activeElement === stops[0]) {
      event.preventDefault()
      event.stopPropagation()
      target.focus()
    } else if (!event.shiftKey && document.activeElement === stops[stops.length - 1]) {
      event.preventDefault()
      event.stopPropagation()
      const next = nextAfter(target)
      if (state.status !== "pinned") close()
      next?.focus()
    }
  }

  // The card's own events, on the card itself: Reka's popover would put them on its wrapper, and its focus scope would
  // take Tab at the card's edges first (so they listen in the capture phase).
  const cardListeners: [string, (event: never) => void, boolean][] = [
    ["pointerenter", (event: PointerEvent) => {
      if (event.pointerType !== "touch" && state.status === "leaving") stayOpen()
    }, false],
    ["pointerleave", (event: PointerEvent) => {
      if (event.pointerType !== "touch") leave()
    }, false],
    ["keydown", cardKey, true],
  ]

  const surface: HoverCardSurface = {
    attach(element) {
      if (element === cardElement) return
      for (const [type, listener, capture] of cardListeners) cardElement?.removeEventListener(type, listener as EventListener, capture)
      cardElement = element
      for (const [type, listener, capture] of cardListeners) element?.addEventListener(type, listener as EventListener, capture)
    },
    get element() {
      return cardElement
    },
    dismiss(reason, target) {
      // A press on one of this card's targets that isn't a control: its click decides (it pins, moves the pin or
      // closes). The focus going back to the target keeps the card too.
      const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null
      const bound = element?.closest(`[data-hover-card="${id}"]`)
      if (bound && (reason === "focus-outside" ? bound === current.value : !bound.closest(CONTROLS))) return false
      if (reason === "focus-outside" && state.status === "pinned") return false
      close({ returnFocus: reason === "escape" })
      return true
    },
  }

  if (getCurrentScope()) onScopeDispose(() => {
    clearTimer()
    setStatus("closed")
  })

  const controller: UseHoverCard<T> = {
    on(card, target = {}) {
      return {
        ...(target.focusable ? { tabindex: 0 } : {}),
        "data-hover-card": id,
        onPointerenter: (event: PointerEvent) => {
          if (event.pointerType !== "touch") enter(event.currentTarget as Element, card, target)
        },
        onPointerleave: (event: PointerEvent) => {
          if (event.pointerType !== "touch" && event.currentTarget === current.value) leave()
        },
        onPointerdown: (event: PointerEvent) => {
          pointerType = event.pointerType
          const element = event.currentTarget as Element
          // Pressing a button or link does what it does: an open (not pinned) card goes, as a tooltip does.
          if (element === current.value && element.closest(CONTROLS) && !stay()) close()
        },
        onClick: (event: MouseEvent) => {
          press(event.currentTarget as Element, card, target)
          pointerType = ""
        },
        onFocus: (event: FocusEvent) => {
          const element = event.currentTarget as Element
          if (returning || stay() || !keyboardFocus(element)) return
          if (element === current.value && isOpen()) return
          openFor(element, card, target.side, "open")
        },
        onBlur: (event: FocusEvent) => {
          if (event.currentTarget !== current.value || stay()) return
          // Into the card (Tab), or back from it: the card stays.
          if (event.relatedTarget instanceof Node && cardElement?.contains(event.relatedTarget)) return
          close()
        },
        onKeydown: targetKey,
        // The target going away (a list that changed) takes its card with it.
        onVnodeBeforeUnmount: (vnode: VNode) => {
          if (vnode.el && vnode.el === current.value) close()
        },
      }
    },
    get props() {
      return { controller }
    },
    get content() {
      return resolve(shown.value)
    },
    get status() {
      return state.status
    },
    get open() {
      return isOpen()
    },
    get pinned() {
      return state.status === "pinned"
    },
    get target() {
      return current.value
    },
    get side() {
      return state.side
    },
    id,
    show(element, card, target = {}) {
      openFor(element, card, target.side, target.pinned ? "pinned" : "open")
    },
    pin,
    close,
    surface,
  }
  return controller
}
