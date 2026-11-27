// One tooltip for many targets, shown the way the kit's title hints are: after a short wait on hover (none while you
// go along a row of them), at once from the keyboard, gone on leave, press, blur, Escape or when the target goes.
//
//   const tip = useTooltip<Card>()
//   <button v-for="card in cards" v-bind="tip.on(card)">…</button>
//   <Tooltip v-bind="tip.props" :title="tip.content?.name">…</Tooltip>
//
// With `shared: sdk.ui.tooltip` the card (a TooltipContent) shows in Tavora's shared tooltip instead, above the
// workspace, so a big card is never cut off at the panel's edge; there is then no <Tooltip> in the panel.
//
// `pin: true` lets a press pin a card open, in the panel as in the shared tooltip: it then takes the pointer, shows a
// close X, and stays until the X, Escape (both give the focus back to its target), a press elsewhere or a second press
// on its target. On touch, which has no hover, a long press shows a target's card.
import { getCurrentScope, onScopeDispose, reactive, shallowRef, type VNode } from 'vue';
import { TOOLTIP_WARM_MS, tooltipDelay, type TooltipDismissReason } from './Tooltip';
import type { TooltipAlign, TooltipRect, TooltipSide } from './geometry';

/** What the helper needs of a shared card (the SDK's TooltipContent has it): its title, and a subtitle if any. */
export interface SharedCard { title: string; subtitle?: string }
/**
 * The part of `sdk.ui.tooltip` the helper uses, by its shape: the kit is also built into the app, which has no SDK.
 * Pass `sdk.ui.tooltip` itself.
 */
export interface SharedTooltip<C = SharedCard> {
  show(request: { id: string; anchor: Element; content: C; pinnable?: boolean; pinned?: boolean }): Promise<unknown>;
  hide(id: string): Promise<unknown>;
  onClose(fn: (event: { id: string }) => void): () => void;
}

export interface UseTooltipOptions {
  /** The wait before the first card shows on hover, in ms. 180 by default, as for title hints. */
  delay?: number;
  /** Where the card goes when there is room. A target can ask for another side. */
  side?: TooltipSide;
  /** Where the card lines up along its target: centred (the default), or with its start or end. */
  align?: TooltipAlign;
  /**
   * A press on a target that isn't a control (a name in a table, a picture, a slot) pins its card open: it takes the
   * pointer (select its text, follow a link), shows a close X and stays until you close it. Hovering other targets leaves
   * it be. On buttons, links and menu rows a press only does what they do, unless the target says `pin`. Off by default.
   */
  pin?: boolean;
}

export interface UseSharedTooltipOptions<T extends SharedCard = SharedCard> extends UseTooltipOptions {
  /**
   * Show the cards in Tavora's shared tooltip: pass `sdk.ui.tooltip`, or a function that gives it once the panel is
   * connected (`() => sdk.value?.ui.tooltip`); until then no card shows.
   */
  shared: SharedTooltip<T> | (() => SharedTooltip<T> | null | undefined);
  /**
   * When Tavora can't show the card (outside Tavora, an older one, the panel not connected yet), show it in the panel
   * instead: bind `tip.props` to an ItemTooltip as well. Off by default.
   */
  fallback?: boolean;
}

export interface TooltipTargetOptions {
  /** Where this target's card goes when there is room. */
  side?: TooltipSide;
  /** Where this target's card lines up along it: centred, or with its start or end (a whole row, a field). */
  align?: TooltipAlign;
  /**
   * Lets the keyboard reach a target that can't take the focus by itself (a chart bar, a cell, a picture), so its
   * card shows by keyboard too. Buttons and links don't need it.
   */
  focusable?: boolean;
  /**
   * For an info button whose only job is the tip: a press opens and closes it, with a finger too (touch has no hover),
   * and it stays until the next press, a press elsewhere or Escape. Hovering and focusing still show it as usual.
   */
  toggle?: boolean;
  /** A press leaves the card open, as for a copy button whose card turns into "Copied". */
  keepOnPress?: boolean;
  /**
   * With the helper's `pin`: a press pins this target's card even though it is a button, for a target whose only job
   * on a press is its card (a slot on a board). Off: a press on a target that isn't a control pins.
   */
  pin?: boolean;
  /** Shows the card only when this says so when it's about to show, such as `isTruncated` for a name cut short. */
  when?: (element: Element) => boolean;
  /**
   * Whether the card names the target or describes it. By default a target without a name of its own (an icon button
   * without `aria-label`) is named by it, any other described.
   */
  as?: 'label' | 'description';
}

/** Whether an element's text is cut short (ellipsis or a clamp), for `when`: only then does a card repeating it help. */
export function isTruncated(element: Element): boolean {
  return element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1;
}

/** Whether an element has a name of its own for a screen reader: a label, a labelledby, or text. */
function named(element: Element): boolean {
  return Boolean(element.getAttribute('aria-label')?.trim() || element.getAttribute('aria-labelledby')?.trim() || element.textContent?.trim() || element.getAttribute('title')?.trim());
}

/**
 * A card, or a function that makes it (nothing: no card for this target). A function is asked again while its card
 * shows, so a card that changes (another language, a live number) stays up to date in the panel.
 */
export type TooltipCard<T> = T | (() => T | null | undefined) | null | undefined;

export interface UseTooltip<T> {
  /** Bind on each target: `v-bind="tip.on(card)"`. */
  on(card: TooltipCard<T>, options?: TooltipTargetOptions): Record<string, unknown>;
  /** Bind on the panel's one tooltip: `<Tooltip v-bind="tip.props">`. (With `shared`, only for its `fallback`.) */
  readonly props: { open: boolean; anchor: TooltipRect; side: TooltipSide; align: TooltipAlign; id: string; pinned: boolean; onDismiss: (reason?: TooltipDismissReason) => void };
  /** Whether the card shown now is pinned open in the panel. */
  readonly pinned: boolean;
  /**
   * The target whose card is pinned, in the panel or in Tavora's shared tooltip (until it closes there), to mark it
   * (a slot drawn as chosen). Null when none is.
   */
  readonly pinnedTarget: Element | null;
  /** The card shown now (or the last one): fill the tooltip from it. */
  readonly content: T | null;
  /** Shows a card for an element at once, as from the keyboard: for an element you don't bind `on` to. */
  show(element: Element, card: TooltipCard<T>, options?: TooltipTargetOptions): void;
  /** Hides the card, and cancels one that is still waiting. */
  hide(): void;
}

const DELAY_MS = 180;
/** How long a finger rests on a target before its card shows (touch has no hover), and how far it may move meanwhile. */
const LONG_PRESS_MS = 450, LONG_PRESS_SLOP = 10;
export const CONTROLS = 'button, a[href], input, select, textarea, [role=button], [role=link], [role=option], [role=menuitem], [role=tab], [role=switch], [role=checkbox], [role=radio]';
let instances = 0;

const resolve = <T>(card: TooltipCard<T>): T | null => (typeof card === 'function' ? (card as () => T | null | undefined)() : card) ?? null;
// Whether the focus moves by keyboard, as title hints tell it (title-tooltips.ts): Tab or an arrow key last, not a press.
const FOCUS_KEYS = new Set(['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']);
let keyboard = false;
let watching = false;
export function watchInput(doc: Document) {
  if (watching) return;
  watching = true;
  doc.addEventListener('keydown', event => { if (FOCUS_KEYS.has(event.key)) keyboard = true; }, true);
  doc.addEventListener('pointerdown', () => { keyboard = false; }, true);
}
/** Whether the focus came from the keyboard. Where the browser can't tell, it counts as keyboard: a card too many is better than none. */
export function keyboardFocus(element: Element): boolean {
  if (keyboard) return true;
  try { return element.matches(':focus-visible'); } catch { return true; }
}

export function useTooltip<T = unknown>(options?: UseTooltipOptions): UseTooltip<T>;
export function useTooltip<T extends SharedCard = SharedCard>(options: UseSharedTooltipOptions<T>): UseTooltip<T>;
export function useTooltip<T>(options: UseTooltipOptions & Partial<UseSharedTooltipOptions<SharedCard>> = {}): UseTooltip<T> {
  const id = `tavora-tip-${++instances}`;
  if (typeof document !== 'undefined') watchInput(document);
  const given = options.shared;
  const sharedTooltip = (): SharedTooltip<SharedCard> | null => (typeof given === 'function' ? given() : given) ?? null;
  // One value for where the card is: none, waiting for the hover delay, showing (here or in Tavora's tooltip), or
  // pinned open in the panel by a press.
  const state = reactive({ status: 'idle' as 'idle' | 'waiting' | 'open' | 'pinned', side: (options.side ?? 'bottom') as TooltipSide, align: (options.align ?? 'center') as TooltipAlign, anchor: { left: 0, top: 0, right: 0, bottom: 0 } as TooltipRect });
  // The card as the module gave it (a function is asked again on each read): not made reactive.
  const shown = shallowRef<TooltipCard<T>>(null);
  let current: Element | null = null;
  /** The shared card's id while it shows, and the tooltip it went to. */
  let sharedCard: { id: string; tooltip: SharedTooltip<SharedCard> } | null = null;
  /** A card pinned in Tavora's shared tooltip: it stays there after the hover ends, until it closes there. */
  const pinnedShared = shallowRef<{ id: string; element: Element } | null>(null);
  /** The card shows in the panel (always without `shared`; with it, as its fallback). */
  const inPanel = shallowRef(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastHidden = -Infinity;
  let serial = 0;
  let unsubscribe: (() => void) | undefined;

  /** How the card shows for the current target: describing it, or naming it (a target without a name of its own). */
  let relation: 'aria-describedby' | 'aria-labelledby' = 'aria-describedby';
  /** The card was opened by a press on a `toggle` target: it stays until the next press, a press elsewhere or Escape. */
  let pressed = false;
  function describe(element: Element, on: boolean) {
    const ids = (element.getAttribute(relation) ?? '').split(' ').filter(value => value && value !== id);
    if (on) ids.push(id);
    if (ids.length) element.setAttribute(relation, ids.join(' '));
    else element.removeAttribute(relation);
  }
  // A press anywhere but on the target (or, for a pinned card, the card itself) closes a card a press opened.
  const outside = (event: PointerEvent) => {
    if (!pressed || !current || !(event.target instanceof Node)) return;
    if (current.contains(event.target)) return;
    // The card is teleported out of the panel's tree: it is known by its id.
    if (state.status === 'pinned' && event.target instanceof Element && event.target.closest('[data-slot=tooltip]')?.id === id) return;
    hide();
  };
  function listenOutside(on: boolean) {
    if (typeof document === 'undefined') return;
    if (on) document.addEventListener('pointerdown', outside, true);
    else document.removeEventListener('pointerdown', outside, true);
  }

  /** A card a press opened (a toggle, a long press, a pin) stays until the next press elsewhere. */
  function holdOpen() {
    if (pressed) return;
    pressed = true;
    listenOutside(true);
  }

  /** Back to no card, without telling Tavora (it closed the card itself, or never showed it). */
  function forget() {
    if (pressed) listenOutside(false);
    pressed = false;
    sharedCard = null;
    current = null;
    state.status = 'idle';
  }

  /** The target the focus is being given back to: its focus doesn't open the card that just closed. */
  let returning: Element | null = null;
  /** A pinned card closed by its X or Escape gives the focus back to its target, where the keyboard left off. */
  function dismiss(reason?: TooltipDismissReason) {
    const back = state.status === 'pinned' && (reason === 'escape' || reason === 'close') ? current : null;
    hide();
    if (!(back instanceof HTMLElement) || !back.isConnected || !(back.tabIndex >= 0 || back.matches(CONTROLS))) return;
    returning = back;
    try { back.focus({ preventScroll: true }); } finally { returning = null; }
  }

  function hide() {
    clearTimeout(timer);
    timer = undefined;
    if (state.status === 'open' || state.status === 'pinned') lastHidden = performance.now();
    if (current && inPanel.value) describe(current, false);
    inPanel.value = false;
    if (pressed) listenOutside(false);
    pressed = false;
    // Ends the hover only: a pinned card stays until you close it (sdk.ui.tooltip.hide).
    if (sharedCard) void sharedCard.tooltip.hide(sharedCard.id).catch(() => undefined);
    forget();
  }

  function showShared(element: Element, card: SharedCard, target: TooltipTargetOptions, pinned: boolean) {
    const side = target.side;
    const tooltip = sharedTooltip();
    if (!tooltip) return options.fallback ? showInPanel(element, side, target.as, target.align) : hide();
    if (!unsubscribe) unsubscribe = tooltip.onClose(({ id: closed }) => {
      if (closed === pinnedShared.value?.id) pinnedShared.value = null;
      if (closed === sharedCard?.id) forget();
    });
    const pinnable = Boolean(options.pin) && pinsOn(element, target);
    // A card that can be pinned keeps one id per card, so pinning it twice doesn't stack two copies.
    const cardId = pinnable ? `${id}-${`${card.title}-${card.subtitle ?? ''}`.replace(/[^\w-]+/g, '_').slice(0, 100)}` : `${id}-${++serial}`;
    sharedCard = { id: cardId, tooltip };
    state.status = 'open';
    // Tavora couldn't show it: show it in the panel (`fallback`), or forget it so the next hover tries again.
    if (pinned && pinnable) pinnedShared.value = { id: cardId, element };
    tooltip.show({ id: cardId, anchor: element, content: card, pinnable, ...(pinned && pinnable ? { pinned: true } : {}) })
      .catch(() => {
        if (pinnedShared.value?.id === cardId) pinnedShared.value = null;
        if (sharedCard?.id !== cardId) return;
        sharedCard = null;
        if (options.fallback && current === element && element.isConnected) {
          showInPanel(element, side, target.as, target.align);
          if (pinned && pinnable) pinInPanel();
        } else forget();
      });
  }

  /** The card in the panel stays open, pinned: until its X, Escape, a press elsewhere or on its target again. */
  function pinInPanel() {
    state.status = 'pinned';
    holdOpen();
  }

  function open(element: Element, target: TooltipTargetOptions, pinned: boolean) {
    const side = target.side;
    timer = undefined;
    const card = resolve(shown.value);
    // `when` asked again now: the text may have changed while the card waited.
    if (!element.isConnected || card === null || (target.when && !target.when(element))) return hide();
    if (given) return showShared(element, card as unknown as SharedCard, target, pinned);
    showInPanel(element, side, target.as, target.align);
    if (pinned && options.pin && pinsOn(element, target)) pinInPanel();
  }

  /** Whether a press on this target pins its card: one that isn't a control, or one that says `pin`. */
  const pinsOn = (element: Element, target: TooltipTargetOptions) => Boolean(target.pin) || !element.closest(CONTROLS);

  function showInPanel(element: Element, side: TooltipSide | undefined, as?: 'label' | 'description', align?: TooltipAlign) {
    const { left, top, right, bottom } = element.getBoundingClientRect();
    state.anchor = { left, top, right, bottom };
    state.side = side ?? options.side ?? 'bottom';
    state.align = align ?? options.align ?? 'center';
    state.status = 'open';
    inPanel.value = true;
    relation = (as ?? (named(element) ? 'description' : 'label')) === 'label' ? 'aria-labelledby' : 'aria-describedby';
    describe(element, true);
  }

  /** Shows `card` for `element` after `wait` ms (at once for 0). */
  function schedule(element: Element, card: TooltipCard<T>, target: TooltipTargetOptions, wait: number, pinned = false) {
    // Already showing for it, or on the way (unless the keyboard asks for it now).
    if (element === current && !pinned && (state.status === 'open' || state.status === 'pinned' || (state.status === 'waiting' && wait > 0))) return;
    hide();
    if (resolve(card) === null || (target.when && !target.when(element))) return;
    current = element;
    shown.value = card;
    if (wait <= 0) return open(element, target, pinned);
    state.status = 'waiting';
    timer = setTimeout(() => open(element, target, pinned), wait);
  }

  function hoverWait() {
    // tooltipDelay knows the kit's in-panel cards; a card of this helper that just went counts too (shared ones).
    return performance.now() - lastHidden < TOOLTIP_WARM_MS ? 0 : tooltipDelay(options.delay ?? DELAY_MS);
  }

  // A finger resting on a target: its card shows after LONG_PRESS_MS, as a press opened it (it stays until the next press
  // elsewhere), and the click that ends the touch is swallowed, so the target doesn't also do what a tap does.
  let longPress: { timer: ReturnType<typeof setTimeout>; element: Element; x: number; y: number; pointer: number } | null = null;
  function cancelLongPress() {
    if (longPress) clearTimeout(longPress.timer);
    longPress = null;
  }
  function swallowNextClick(element: Element) {
    if (typeof document === 'undefined') return;
    const swallow = (event: MouseEvent) => {
      if (event.target instanceof Node && element.contains(event.target)) { event.preventDefault(); event.stopPropagation(); }
      done();
    };
    const done = () => { clearTimeout(expiry); document.removeEventListener('click', swallow, true); };
    const expiry = setTimeout(done, 800);
    document.addEventListener('click', swallow, true);
  }

  if (getCurrentScope()) onScopeDispose(() => { cancelLongPress(); hide(); unsubscribe?.(); });

  return {
    on(card, target = {}) {
      // A card a press opened stays when the pointer or the focus moves on; anything else closes it.
      const leave = (event: Event) => { if (event.currentTarget === current && !pressed) hide(); };
      // The focus moving on closes even a card a press opened (Tab away from an info button), but not a pinned one: the
      // focus may go into it, or the X.
      const blur = (event: Event) => { if (event.currentTarget === current && state.status !== 'pinned') hide(); };
      // While a card is pinned, other targets show nothing on hover or focus: the pinned one stays in sight.
      const free = () => state.status !== 'pinned';
      return {
        ...(target.focusable ? { tabindex: 0 } : {}),
        onPointerenter: (event: PointerEvent) => {
          // Touch has no hover: a tap is for the target itself (a long press shows the card).
          if (event.pointerType !== 'touch' && free()) schedule(event.currentTarget as Element, card, target, hoverWait());
        },
        onPointerleave: leave,
        onFocus: (event: FocusEvent) => { if (free() && event.currentTarget !== returning && keyboardFocus(event.currentTarget as Element)) schedule(event.currentTarget as Element, card, target, 0); },
        onBlur: blur,
        // A press closes the card (it would cover what the press changed), except on a `toggle` target (the click
        // decides), one that keeps it, or one a press pins (the click decides there too).
        onPointerdown: (event: PointerEvent) => {
          const element = event.currentTarget as Element;
          if (event.pointerType === 'touch' && !target.toggle) {
            cancelLongPress();
            const timer = setTimeout(() => {
              longPress = null;
              if (!element.isConnected) return;
              schedule(element, card, target, 0, true);
              if (current === element && state.status !== 'idle') holdOpen();
              swallowNextClick(element);
            }, LONG_PRESS_MS);
            longPress = { timer, element, x: event.clientX, y: event.clientY, pointer: event.pointerId };
          }
          const pins = Boolean(options.pin) && pinsOn(element, target);
          if (!target.toggle && !target.keepOnPress && !pins && state.status !== 'pinned') leave(event);
        },
        onPointermove: (event: PointerEvent) => {
          if (longPress && event.pointerId === longPress.pointer && Math.hypot(event.clientX - longPress.x, event.clientY - longPress.y) > LONG_PRESS_SLOP) cancelLongPress();
        },
        onPointerup: cancelLongPress,
        onPointercancel: cancelLongPress,
        onKeydown: (event: KeyboardEvent) => {
          const element = event.currentTarget as Element;
          if (event.key === 'Escape' && element === current) return dismiss('escape');
          // A target that isn't a control has no click for Enter: Enter pins (or unpins) its card from the keyboard.
          if (event.key === 'Enter' && options.pin && !element.closest(CONTROLS) && pinsOn(element, target)) {
            event.preventDefault();
            if (element === current && state.status === 'pinned') return hide();
            schedule(element, card, target, 0, true);
          }
        },
        ...(target.toggle ? {
          onClick: (event: MouseEvent) => {
            const element = event.currentTarget as Element;
            if (element === current && state.status === 'open') {
              if (pressed) return hide();
              // Opened by hovering: the press keeps it, as if the press had opened it.
              holdOpen();
              return;
            }
            schedule(element, card, target, 0, true);
            if (current === element) holdOpen();
          },
        } : options.pin ? {
          onClick: (event: MouseEvent) => {
            const element = event.currentTarget as Element;
            if (!pinsOn(element, target)) return;
            // A second press on the pinned card's own target closes it; on another target, that one's card is pinned.
            if (element === current && state.status === 'pinned') return hide();
            schedule(element, card, target, 0, true);
          },
        } : {}),
        // The target going away (a list that changed) takes its card with it.
        onVnodeBeforeUnmount: (vnode: VNode) => { if (vnode.el && vnode.el === current) hide(); if (vnode.el && vnode.el === longPress?.element) cancelLongPress(); },
      };
    },
    get props() {
      const shown = state.status === 'open' || state.status === 'pinned';
      return { open: shown && inPanel.value, anchor: state.anchor, side: state.side, align: state.align, id, pinned: state.status === 'pinned' && inPanel.value, onDismiss: dismiss };
    },
    get pinned() {
      return state.status === 'pinned';
    },
    get pinnedTarget() {
      if (state.status === 'pinned') return current;
      const shared = pinnedShared.value;
      return shared?.element.isConnected ? shared.element : null;
    },
    get content() {
      return resolve(shown.value);
    },
    show(element, card, target = {}) {
      schedule(element, card, target, 0);
    },
    hide,
  };
}
