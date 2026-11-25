// One tooltip for many targets, shown the way the kit's title hints are: after a short wait on hover (none while you
// go along a row of them), at once from the keyboard, gone on leave, press, blur, Escape or when the target goes.
//
//   const tip = useTooltip<Card>()
//   <button v-for="card in cards" v-bind="tip.on(card)">…</button>
//   <Tooltip v-bind="tip.props" :title="tip.content?.name">…</Tooltip>
//
// With `shared: sdk.ui.tooltip` the card (a TooltipContent) shows in Tavora's shared tooltip instead, above the
// workspace, so a big card is never cut off at the panel's edge; there is then no <Tooltip> in the panel.
import type { TavoraSDK, TooltipContent } from '@tavora/sdk';
import { getCurrentScope, onScopeDispose, reactive, shallowRef, type VNode } from 'vue';
import { tooltipDelay } from './Tooltip';
import type { TooltipRect, TooltipSide } from './geometry';

/** The part of `sdk.ui.tooltip` the helper uses. */
export type SharedTooltip = Pick<TavoraSDK['ui']['tooltip'], 'show' | 'hide' | 'onClose'>;

export interface UseTooltipOptions {
  /** The wait before the first card shows on hover, in ms. 180 by default, as for title hints. */
  delay?: number;
  /** Where the card goes when there is room. A target can ask for another side. */
  side?: TooltipSide;
}

export interface UseSharedTooltipOptions extends UseTooltipOptions {
  /** Show the cards in Tavora's shared tooltip: pass `sdk.ui.tooltip`. */
  shared: SharedTooltip;
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

/** A card, or a function that makes it when it's about to show (nothing: no card for this target). */
export type TooltipCard<T> = T | (() => T | null | undefined) | null | undefined;

export interface UseTooltip<T> {
  /** Bind on each target: `v-bind="tip.on(card)"`. */
  on(card: TooltipCard<T>, options?: TooltipTargetOptions): Record<string, unknown>;
  /** Bind on the panel's one tooltip: `<Tooltip v-bind="tip.props">`. (Not needed with `shared`.) */
  readonly props: { open: boolean; anchor: TooltipRect; side: TooltipSide; id: string; onDismiss: () => void };
  /** The card shown now, or the last one while it closes: fill the tooltip from it. */
  readonly content: T | null;
  /** Shows a card for an element at once, as from the keyboard: for an element you don't bind `on` to. */
  show(element: Element, card: TooltipCard<T>, options?: TooltipTargetOptions): void;
  /** Hides the card, and cancels one that is still waiting. */
  hide(): void;
}

const DELAY_MS = 180;
/** As for the in-panel tooltip (Tooltip.ts): a card shown right after another counts as a follow-up and doesn't wait. */
const WARM_MS = 400;
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
export function useTooltip<T extends TooltipContent = TooltipContent>(options: UseSharedTooltipOptions): UseTooltip<T>;
export function useTooltip<T>(options: UseTooltipOptions & Partial<UseSharedTooltipOptions> = {}): UseTooltip<T> {
  const id = `tavora-tip-${++instances}`;
  if (typeof document !== 'undefined') watchInput(document);
  const shared = options.shared;
  const state = reactive({ open: false, side: (options.side ?? 'bottom') as TooltipSide, anchor: { left: 0, top: 0, right: 0, bottom: 0 } as TooltipRect });
  // The card as the module gave it: not made reactive, so its refs and objects stay as they are.
  const shown = shallowRef<T | null>(null);
  let current: Element | null = null;
  let sharedId: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastHidden = -Infinity;
  let serial = 0;

  function describe(element: Element, on: boolean) {
    const ids = (element.getAttribute('aria-describedby') ?? '').split(' ').filter(value => value && value !== id);
    if (on) ids.push(id);
    if (ids.length) element.setAttribute('aria-describedby', ids.join(' '));
    else element.removeAttribute('aria-describedby');
  }

  function hide() {
    clearTimeout(timer);
    timer = undefined;
    if (current && (state.open || sharedId)) lastHidden = performance.now();
    if (current && !shared) describe(current, false);
    if (shared && sharedId) void shared.hide(sharedId).catch(() => undefined);
    sharedId = null;
    current = null;
    state.open = false;
  }

  function open(element: Element, content: T, side: TooltipSide | undefined, pinned: boolean) {
    if (!element.isConnected) return hide();
    current = element;
    shown.value = content;
    if (shared) {
      const card = content as unknown as TooltipContent;
      const pinnable = Boolean(options.pin) && !element.closest(CONTROLS);
      // A card that can be pinned keeps one id per card, so pinning it twice doesn't stack two copies.
      sharedId = pinnable ? `${id}-${`${card.title}-${card.subtitle ?? ''}`.replace(/[^\w-]+/g, '_').slice(0, 100)}` : `${id}-${++serial}`;
      void shared.show({ id: sharedId, anchor: element, content: card, pinnable, ...(pinned && pinnable ? { pinned: true } : {}) }).catch(() => undefined);
      return;
    }
    const { left, top, right, bottom } = element.getBoundingClientRect();
    state.anchor = { left, top, right, bottom };
    state.side = side ?? options.side ?? 'bottom';
    state.open = true;
    describe(element, true);
  }

  /** Shows `card` for `element` after `wait` ms (at once for 0). */
  function schedule(element: Element, card: TooltipCard<T>, target: TooltipTargetOptions, wait: number, pinned = false) {
    // Already showing for it, or on the way (unless the keyboard asks for it now).
    if (element === current && !pinned && (state.open || sharedId || (timer && wait > 0))) return;
    const content = resolve(card);
    hide();
    if (content === null) return;
    current = element;
    const go = () => { timer = undefined; open(element, content, target.side, pinned); };
    if (wait <= 0) go();
    else timer = setTimeout(go, wait);
  }

  function hoverWait() {
    // tooltipDelay knows the kit's in-panel cards; a shared card that just went counts too.
    const wait = tooltipDelay(options.delay ?? DELAY_MS);
    return performance.now() - lastHidden < WARM_MS ? 0 : wait;
  }

  let unsubscribe: (() => void) | undefined;
  if (shared) unsubscribe = shared.onClose(({ id: closed }) => { if (closed === sharedId) { sharedId = null; current = null; } });
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
        onPointerdown: (event: PointerEvent) => { if (event.currentTarget === current || timer) hide(); },
        onKeydown: (event: KeyboardEvent) => { if (event.key === 'Escape' && event.currentTarget === current) hide(); },
        ...(shared && options.pin ? {
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
      return { open: state.open, anchor: state.anchor, side: state.side, id, onDismiss: hide };
    },
    get content() {
      return shown.value;
    },
    show(element, card, target = {}) {
      schedule(element, card, target, 0);
    },
    hide,
  };
}
