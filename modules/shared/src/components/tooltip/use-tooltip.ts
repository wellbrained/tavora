// One tooltip for many targets, shown the way the kit's title hints are: after a short wait on hover (none while you
// go along a row of them), at once from the keyboard, gone on leave, press, blur, Escape or when the target goes.
//
//   const tip = useTooltip<Card>()
//   <button v-for="card in cards" v-bind="tip.on(card)">…</button>
//   <Tooltip v-bind="tip.props" :title="tip.content?.name">…</Tooltip>
//
// With `shared: sdk.ui.tooltip` the card (a TooltipContent) shows in Tavora's shared tooltip instead, above the
// workspace, so a big card is never cut off at the panel's edge; there is then no <Tooltip> in the panel.
import { getCurrentScope, onScopeDispose, reactive, shallowRef, type VNode } from 'vue';
import { TOOLTIP_WARM_MS, tooltipDelay } from './Tooltip';
import type { TooltipRect, TooltipSide } from './geometry';

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
}

export interface UseSharedTooltipOptions<T extends SharedCard = SharedCard> extends UseTooltipOptions {
  /**
   * Show the cards in Tavora's shared tooltip: pass `sdk.ui.tooltip`, or a function that gives it once the panel is
   * connected (`() => sdk.value?.ui.tooltip`); until then no card shows.
   */
  shared: SharedTooltip<T> | (() => SharedTooltip<T> | null | undefined);
  /**
   * A click on a target that isn't a control (a name in a table, a picture) pins its card, so you can read it while
   * you do something else. On buttons, links and menu rows a click only does what they do. Off by default.
   */
  pin?: boolean;
}

export interface TooltipTargetOptions {
  /** Where this target's card goes when there is room. */
  side?: TooltipSide;
  /**
   * Lets the keyboard reach a target that can't take the focus by itself (a chart bar, a cell, a picture), so its
   * card shows by keyboard too. Buttons and links don't need it.
   */
  focusable?: boolean;
}

/**
 * A card, or a function that makes it (nothing: no card for this target). A function is asked again while its card
 * shows, so a card that changes (another language, a live number) stays up to date in the panel.
 */
export type TooltipCard<T> = T | (() => T | null | undefined) | null | undefined;

export interface UseTooltip<T> {
  /** Bind on each target: `v-bind="tip.on(card)"`. */
  on(card: TooltipCard<T>, options?: TooltipTargetOptions): Record<string, unknown>;
  /** Bind on the panel's one tooltip: `<Tooltip v-bind="tip.props">`. (Not needed with `shared`.) */
  readonly props: { open: boolean; anchor: TooltipRect; side: TooltipSide; id: string; onDismiss: () => void };
  /** The card shown now (or the last one): fill the tooltip from it. */
  readonly content: T | null;
  /** Shows a card for an element at once, as from the keyboard: for an element you don't bind `on` to. */
  show(element: Element, card: TooltipCard<T>, options?: TooltipTargetOptions): void;
  /** Hides the card, and cancels one that is still waiting. */
  hide(): void;
}

const DELAY_MS = 180;
const CONTROLS = 'button, a[href], input, select, textarea, [role=button], [role=link], [role=option], [role=menuitem], [role=tab], [role=switch], [role=checkbox], [role=radio]';
let instances = 0;

const resolve = <T>(card: TooltipCard<T>): T | null => (typeof card === 'function' ? (card as () => T | null | undefined)() : card) ?? null;
// Whether the focus moves by keyboard, as title hints tell it (title-tooltips.ts): Tab or an arrow key last, not a press.
const FOCUS_KEYS = new Set(['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']);
let keyboard = false;
let watching = false;
function watchInput(doc: Document) {
  if (watching) return;
  watching = true;
  doc.addEventListener('keydown', event => { if (FOCUS_KEYS.has(event.key)) keyboard = true; }, true);
  doc.addEventListener('pointerdown', () => { keyboard = false; }, true);
}
/** Whether the focus came from the keyboard. Where the browser can't tell, it counts as keyboard: a card too many is better than none. */
function keyboardFocus(element: Element): boolean {
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
  // One value for where the card is: none, waiting for the hover delay, or showing (here or in Tavora's tooltip).
  const state = reactive({ status: 'idle' as 'idle' | 'waiting' | 'open', side: (options.side ?? 'bottom') as TooltipSide, anchor: { left: 0, top: 0, right: 0, bottom: 0 } as TooltipRect });
  // The card as the module gave it (a function is asked again on each read): not made reactive.
  const shown = shallowRef<TooltipCard<T>>(null);
  let current: Element | null = null;
  /** The shared card's id while it shows, and the tooltip it went to. */
  let sharedCard: { id: string; tooltip: SharedTooltip<SharedCard> } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastHidden = -Infinity;
  let serial = 0;
  let unsubscribe: (() => void) | undefined;

  function describe(element: Element, on: boolean) {
    const ids = (element.getAttribute('aria-describedby') ?? '').split(' ').filter(value => value && value !== id);
    if (on) ids.push(id);
    if (ids.length) element.setAttribute('aria-describedby', ids.join(' '));
    else element.removeAttribute('aria-describedby');
  }

  /** Back to no card, without telling Tavora (it closed the card itself, or never showed it). */
  function forget() {
    sharedCard = null;
    current = null;
    state.status = 'idle';
  }

  function hide() {
    clearTimeout(timer);
    timer = undefined;
    if (state.status === 'open') lastHidden = performance.now();
    if (current && !given) describe(current, false);
    // Ends the hover only: a pinned card stays until you close it (sdk.ui.tooltip.hide).
    if (sharedCard) void sharedCard.tooltip.hide(sharedCard.id).catch(() => undefined);
    forget();
  }

  function showShared(element: Element, card: SharedCard, pinned: boolean) {
    const tooltip = sharedTooltip();
    if (!tooltip) return hide();
    if (!unsubscribe) unsubscribe = tooltip.onClose(({ id: closed }) => { if (closed === sharedCard?.id) forget(); });
    const pinnable = Boolean(options.pin) && !element.closest(CONTROLS);
    // A card that can be pinned keeps one id per card, so pinning it twice doesn't stack two copies.
    const cardId = pinnable ? `${id}-${`${card.title}-${card.subtitle ?? ''}`.replace(/[^\w-]+/g, '_').slice(0, 100)}` : `${id}-${++serial}`;
    sharedCard = { id: cardId, tooltip };
    state.status = 'open';
    // Tavora couldn't show it: forget it, so the next hover tries again.
    tooltip.show({ id: cardId, anchor: element, content: card, pinnable, ...(pinned && pinnable ? { pinned: true } : {}) })
      .catch(() => { if (sharedCard?.id === cardId) forget(); });
  }

  function open(element: Element, side: TooltipSide | undefined, pinned: boolean) {
    timer = undefined;
    const card = resolve(shown.value);
    if (!element.isConnected || card === null) return hide();
    if (given) return showShared(element, card as unknown as SharedCard, pinned);
    const { left, top, right, bottom } = element.getBoundingClientRect();
    state.anchor = { left, top, right, bottom };
    state.side = side ?? options.side ?? 'bottom';
    state.status = 'open';
    describe(element, true);
  }

  /** Shows `card` for `element` after `wait` ms (at once for 0). */
  function schedule(element: Element, card: TooltipCard<T>, target: TooltipTargetOptions, wait: number, pinned = false) {
    // Already showing for it, or on the way (unless the keyboard asks for it now).
    if (element === current && !pinned && (state.status === 'open' || (state.status === 'waiting' && wait > 0))) return;
    hide();
    if (resolve(card) === null) return;
    current = element;
    shown.value = card;
    if (wait <= 0) return open(element, target.side, pinned);
    state.status = 'waiting';
    timer = setTimeout(() => open(element, target.side, pinned), wait);
  }

  function hoverWait() {
    // tooltipDelay knows the kit's in-panel cards; a card of this helper that just went counts too (shared ones).
    return performance.now() - lastHidden < TOOLTIP_WARM_MS ? 0 : tooltipDelay(options.delay ?? DELAY_MS);
  }

  if (getCurrentScope()) onScopeDispose(() => { hide(); unsubscribe?.(); });

  return {
    on(card, target = {}) {
      const leave = (event: Event) => { if (event.currentTarget === current) hide(); };
      return {
        ...(target.focusable ? { tabindex: 0 } : {}),
        onPointerenter: (event: PointerEvent) => {
          // Touch has no hover: a tap is for the target itself.
          if (event.pointerType !== 'touch') schedule(event.currentTarget as Element, card, target, hoverWait());
        },
        onPointerleave: leave,
        onFocus: (event: FocusEvent) => { if (keyboardFocus(event.currentTarget as Element)) schedule(event.currentTarget as Element, card, target, 0); },
        onBlur: leave,
        onPointerdown: leave,
        onKeydown: (event: KeyboardEvent) => { if (event.key === 'Escape' && event.currentTarget === current) hide(); },
        ...(given && options.pin ? {
          onClick: (event: MouseEvent) => {
            const element = event.currentTarget as Element;
            if (!element.closest(CONTROLS)) schedule(element, card, target, 0, true);
          },
        } : {}),
        // The target going away (a list that changed) takes its card with it.
        onVnodeBeforeUnmount: (vnode: VNode) => { if (vnode.el && vnode.el === current) hide(); },
      };
    },
    get props() {
      return { open: state.status === 'open' && !given, anchor: state.anchor, side: state.side, id, onDismiss: hide };
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
