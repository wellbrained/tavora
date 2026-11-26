import { Comment, defineComponent, Fragment, h, mergeProps, Teleport, nextTick, onMounted, onUnmounted, ref, watch, type PropType, type VNode } from 'vue';
import { pointAnchor, tooltipPlacement, TOOLTIP_MAX_WIDTH, type TooltipAlign, type TooltipPoint, type TooltipRect, type TooltipSide } from './geometry';
import { uiText } from '../ui/text';
import { isMac } from '../../lib/platform';
import './tooltip.css';

const KEY_CAPS: Record<string, string> = { Escape: 'Esc', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };

/**
 * Keys of a shortcut as written in `aria-keyshortcuts` ("Control+D") or plainly ("Ctrl+D"), as key caps in the
 * language shown ("Strg" in German, "Cmd" for Meta on a Mac). Of several alternatives ("Control+Y Control+Shift+Z"),
 * the first.
 */
export function shortcutKeys(shortcut: string): string[] {
  // Alternatives are split where a new one starts with a modifier, so a plain "Ctrl + Mouse wheel" stays whole.
  const first = shortcut.replace(/\s*\+\s*/g, '+').trim().split(/\s+(?=(?:Control|Ctrl|Meta|Mod|mod|Alt|Shift)\+)/)[0] ?? '';
  return first.split(/\+(?!$)/).filter(Boolean).map(key => {
    if (key === 'Control' || key === 'Ctrl') return uiText.value.ctrl;
    // "mod": Ctrl, or Cmd on a Mac, for a shortcut written once for both.
    if (key.toLowerCase() === 'mod') return isMac ? 'Cmd' : uiText.value.ctrl;
    if (key === 'Meta') return isMac ? 'Cmd' : 'Win';
    return KEY_CAPS[key] ?? (key.length === 1 ? key.toUpperCase() : key);
  });
}

/** A path or address has no spaces to wrap at: let it wrap after each slash instead of inside a word. */
const wrappable = (text: string) => /\s/.test(text) ? text : text.replace(/([\\/])/g, '$1​');

/** How wide a card may get: `sm` (the default) for a few lines, `md` and `lg` for rows with several columns, or pixels. */
export type TooltipWidth = 'sm' | 'md' | 'lg' | number;
const WIDTHS: Record<Exclude<TooltipWidth, number>, number> = { sm: TOOLTIP_MAX_WIDTH, md: 360, lg: 520 };
/** The widest a card of this width gets, before the window narrows it. */
export function tooltipMaxWidth(width: TooltipWidth = 'sm'): number {
  // 80 px is the narrowest a card gets beside its anchor (geometry.ts); a smaller number would only cut the text.
  return typeof width === 'number' ? Math.max(80, width) : WIDTHS[width] ?? TOOLTIP_MAX_WIDTH;
}

/** Whether a slot drew something: a `v-if` that is off leaves only a comment. */
function drawn(nodes: VNode[] | undefined): nodes is VNode[] {
  return Boolean(nodes?.some(node => node.type === Comment ? false : node.type === Fragment ? drawn(node.children as VNode[]) : true));
}

/** How long after one tooltip goes away the next still counts as a follow-up, as in a row of toolbar buttons. */
export const TOOLTIP_WARM_MS = 400;
let openTooltips = 0;
let lastClosed = -Infinity;
/** How long a closing tooltip fades out (tooltip.css, tavora-tooltip-out). */
export const TOOLTIP_CLOSE_MS = 100;
/** Tooltips fading out now: the next one that opens ends them at once, so going along a row swaps without a fade. */
const fading = new Set<() => void>();

/** Whether a tooltip is open now or was a moment ago: the next one then comes without waiting or fading in. */
export function tooltipsWarm(): boolean {
  return openTooltips > 0 || performance.now() - lastClosed < TOOLTIP_WARM_MS;
}
/** The wait before a tooltip shows. None once you are going along a row of them; `ms` for the first. */
export function tooltipDelay(ms: number): number {
  return tooltipsWarm() ? 0 : ms;
}

/** Presentational hover card shared by Vue, React and vanilla module adapters. */
export default defineComponent({
  name: 'Tooltip',
  // The card sits in a Teleport, so a `class`, `data-testid` or other attribute goes on the card itself.
  inheritAttrs: false,
  props: {
    open: { type: Boolean, required: true },
    /** The box of the thing the card is for. The card sits beside it with a gap, its arrow pointing at it. */
    anchor: Object as PropType<TooltipRect>,
    /** Only a pointer position: the card keeps clear of the cursor. Use `anchor` when you have the element. */
    at: Object as PropType<TooltipPoint>,
    /** Where the card goes when there is room. */
    side: { type: String as PropType<TooltipSide>, default: 'bottom' },
    /** Lines the card up with the element's start or end instead of its middle, for a hint on a whole row or field. */
    align: { type: String as PropType<TooltipAlign>, default: 'center' },
    title: { type: String, default: '' },
    description: String,
    /** A keyboard shortcut beside the title, such as "Ctrl+D". */
    shortcut: String,
    /** Tints the title for a warning or a problem; the card itself stays the same. `danger` is the old name of `destructive`, read for one round. */
    tone: String as PropType<'warning' | 'destructive' | 'danger'>,
    id: String,
    /** Smaller type and padding, for a one-line label. */
    compact: Boolean,
    /** A short word in an outline badge beside the title, such as "Passive". The `badges` slot takes more. */
    badge: String,
    /** Small muted text at the right of the title, such as "Level 3". The `meta` slot takes anything. */
    meta: String,
    /**
     * A line under the title and description, between them and what you put in the card. Text that belongs under the
     * line goes in the card as a `<p>` instead of `description`. Drawn only when there is something above and below it.
     */
    divider: Boolean,
    /** How wide the card may get: `sm` (280 px), `md`, `lg` or pixels. It never gets wider than the window. */
    width: { type: [String, Number] as PropType<TooltipWidth>, default: 'sm' },
    /**
     * For the kit's ItemTooltip: the card brings its own surface and width (an item card), so the tooltip draws no
     * padding, background or edge, and never squeezes it beside the element.
     */
    bare: Boolean,
    /** The arrow pointing at the element. ItemTooltip turns it off where it can't take the card's look (a skin, a unit). */
    arrow: { type: Boolean, default: true },
  },
  emits: ['dismiss'],
  setup(props, { attrs, emit, slots }) {
    const card = ref<HTMLElement | null>(null);
    const position = ref({ left: 0, top: 0, width: 360, side: 'bottom' as TooltipSide, arrow: 0 });
    const ready = ref(false);
    /** Shown while another was open: it appears at once instead of fading in. */
    const instant = ref(false);
    /** Closing: still drawn for a moment, fading out (tooltip.css), then gone. */
    const closing = ref(false);
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    const finishClose = () => { clearTimeout(closeTimer); fading.delete(finishClose); closing.value = false; ready.value = false; };
    let counted = false;
    let generation = 0;
    function track(open: boolean) {
      if (open === counted) return;
      counted = open;
      if (open) openTooltips++;
      else { openTooltips--; lastClosed = performance.now(); }
    }
    // Synchronous, so a tooltip that closes as the next one opens is already counted as closed.
    watch(() => props.open, (open) => {
      if (open) {
        instant.value = tooltipsWarm();
        finishClose();
        // Another tooltip still fading out goes at once: one card at a time, and a row of them swaps without a fade.
        for (const end of [...fading]) end();
      } else if (ready.value) {
        closing.value = true;
        fading.add(finishClose);
        closeTimer = setTimeout(finishClose, TOOLTIP_CLOSE_MS);
      }
      track(open);
    }, { immediate: true, flush: 'sync' });
    const anchor = () => props.anchor ?? pointAnchor(props.at ?? { x: 0, y: 0 });
    async function place() {
      const version = ++generation;
      // A closing card keeps its place while it fades out.
      if (!props.open) { if (!closing.value) ready.value = false; return; }
      const viewport = { width: innerWidth, height: innerHeight }, side = props.side, max = tooltipMaxWidth(props.width);
      position.value = tooltipPlacement(anchor(), 0, 0, viewport, side, max, props.bare, props.align);
      // Measure, place, and measure again if a side placement made the card narrower and so taller.
      for (let pass = 0; pass < 2; pass++) {
        await nextTick();
        if (version !== generation || !card.value) return;
        const box = card.value.getBoundingClientRect();
        // Whole pixels up: a card held to its exact fractional width can lay out a hair narrower and break a word.
        const measured = { width: Math.ceil(box.width), height: Math.ceil(box.height) };
        const placed = tooltipPlacement(anchor(), measured.width, measured.height, viewport, side, max, props.bare, props.align);
        position.value = placed;
        if (placed.width >= measured.width) break;
      }
      ready.value = true;
    }
    watch(() => [props.open, props.anchor, props.at?.x, props.at?.y, props.side, props.align, props.title, props.description, props.shortcut, props.badge, props.meta, props.divider, props.width], place, { immediate: true });
    const dismiss = () => emit('dismiss');
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss(); };
    // Only an open tooltip listens to the window: a list of closed ones adds nothing to every scroll and key.
    let listening = false;
    function listen(on: boolean) {
      if (on === listening) return;
      listening = on;
      const change = on ? window.addEventListener.bind(window) : window.removeEventListener.bind(window);
      change('blur', dismiss);
      change('resize', dismiss);
      change('scroll', dismiss, true);
      change('keydown', key, true);
    }
    onMounted(() => watch(() => props.open, (open) => listen(!!open), { immediate: true }));
    onUnmounted(() => {
      generation++;
      track(false);
      finishClose();
      listen(false);
    });
    /** The title line's own parts: badges after the title, meta text at the right. Null when it is the title alone. */
    function extras() {
      // The badge looks like the kit's outline Badge (ui/badge/index.ts), drawn by tooltip.css: title tooltips in React
      // and plain modules use this card too, and shouldn't need the Badge component or Tailwind for it. Keep the two alike.
      const slotted = slots.badges?.(), slottedMeta = slots.meta?.();
      const badges = drawn(slotted) ? slotted : props.badge ? [h('span', { class: 'tavora-tooltip-badge', 'data-slot': 'badge' }, props.badge)] : null;
      const meta = drawn(slottedMeta) ? slottedMeta : props.meta;
      return badges || meta ? { badges, meta } : null;
    }
    function head() {
      const keys = props.shortcut ? h('span', { class: 'tavora-tooltip-keys' }, shortcutKeys(props.shortcut).map(key => h('kbd', key))) : null;
      const slottedTitle = slots.title?.(), title = drawn(slottedTitle) ? slottedTitle : props.title, more = extras();
      // The title truncates when badges or meta share its line, so they never get pushed out of the card.
      if (title && more) return [h('div', { class: 'tavora-tooltip-head', 'data-parts': 'true' }, [
        h('div', { class: 'tavora-tooltip-name' }, [h('div', { class: 'tavora-tooltip-title' }, title), more.badges ? h('span', { class: 'tavora-tooltip-badges' }, more.badges) : null]),
        more.meta ? h('span', { class: 'tavora-tooltip-meta' }, more.meta) : null, keys,
      ]), props.description ? h('p', wrappable(props.description)) : null];
      if (title) return [h('div', { class: 'tavora-tooltip-head' }, [h('div', { class: 'tavora-tooltip-title' }, title), keys]), props.description ? h('p', wrappable(props.description)) : null];
      // A one-line hint is its own label: the text takes the title's place beside the keys.
      if (keys && props.description) return [h('div', { class: 'tavora-tooltip-head' }, [h('p', wrappable(props.description)), keys])];
      return [props.description ? h('p', wrappable(props.description)) : null];
    }
    /** What you put in the card, under a line when `divider` is on and there is something above and below it. */
    function body() {
      const content = slots.default?.();
      const above = Boolean(props.title || drawn(slots.title?.()) || props.description);
      return [props.divider && drawn(content) && above ? h('hr', { class: 'tavora-tooltip-divider', 'aria-hidden': 'true' }) : null, content];
    }
    return () => h(Teleport, { to: 'body' }, props.open || closing.value ? [h('section', mergeProps(attrs, {
      // A closing card is only a picture fading out: no longer the tooltip for anyone (id, role, a screen reader).
      ...(props.open ? { id: props.id, role: 'tooltip', 'data-slot': 'tooltip' } : { 'data-slot': 'tooltip-closing', 'aria-hidden': 'true' }), ref: card, 'data-side': position.value.side, 'data-tone': props.tone === 'danger' ? 'destructive' : props.tone, // A closing card is no longer ready: its fade-out then wins over the fade-in (tooltip.css).
      'data-ready': ready.value && !closing.value ? 'true' : undefined, 'data-instant': instant.value ? 'true' : undefined, 'data-closing': !props.open && closing.value ? 'true' : undefined,
      'data-bare': props.bare ? 'true' : undefined,
      class: props.compact ? 'tavora-tooltip compact' : 'tavora-tooltip',
      style: { left: position.value.left + 'px', top: position.value.top + 'px', maxWidth: position.value.width + 'px', '--tavora-tooltip-arrow': position.value.arrow + 'px', visibility: ready.value ? 'visible' : 'hidden' },
    }), [...head(), ...body(), props.arrow ? h('span', { class: 'tavora-tooltip-arrow', 'aria-hidden': 'true' }) : null])] : []);
  },
});
