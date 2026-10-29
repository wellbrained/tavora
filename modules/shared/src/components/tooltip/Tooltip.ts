import { defineComponent, h, Teleport, nextTick, onMounted, onUnmounted, ref, watch, type PropType } from 'vue';
import { pointAnchor, tooltipPlacement, type TooltipPoint, type TooltipRect, type TooltipSide } from './geometry';
import './tooltip.css';

/** Keys of a shortcut as written in `aria-keyshortcuts` ("Control+D") or plainly ("Ctrl+D"), as key caps. */
export function shortcutKeys(shortcut: string): string[] {
  return shortcut.split('+').map(key => key.trim()).filter(Boolean).map(key => key === 'Control' ? 'Ctrl' : key);
}

/** A path or address has no spaces to wrap at: let it wrap after each slash instead of inside a word. */
const wrappable = (text: string) => /\s/.test(text) ? text : text.replace(/([\\/])/g, '$1​');

/** Presentational hover card shared by Vue, React and vanilla module adapters. */
export default defineComponent({
  name: 'Tooltip',
  props: {
    open: { type: Boolean, required: true },
    /** The box of the thing the card is for. The card sits beside it with a gap, its arrow pointing at it. */
    anchor: Object as PropType<TooltipRect>,
    /** Only a pointer position: the card keeps clear of the cursor. Use `anchor` when you have the element. */
    at: Object as PropType<TooltipPoint>,
    /** Where the card goes when there is room. */
    side: { type: String as PropType<TooltipSide>, default: 'bottom' },
    title: { type: String, default: '' },
    description: String,
    /** A keyboard shortcut beside the title, such as "Ctrl+D". */
    shortcut: String,
    /** Tints the title for a warning or a problem; the card itself stays the same. */
    tone: String as PropType<'warning' | 'danger'>,
    id: String,
    /** Smaller type and padding, for a one-line label. */
    compact: Boolean,
  },
  emits: ['dismiss'],
  setup(props, { emit, slots }) {
    const card = ref<HTMLElement | null>(null);
    const position = ref({ left: 0, top: 0, width: 360, side: 'bottom' as TooltipSide, arrow: 0 });
    const ready = ref(false);
    let generation = 0;
    const anchor = () => props.anchor ?? pointAnchor(props.at ?? { x: 0, y: 0 });
    async function place() {
      const version = ++generation;
      if (!props.open) { ready.value = false; return; }
      const viewport = { width: innerWidth, height: innerHeight }, side = props.side;
      position.value = tooltipPlacement(anchor(), 0, 0, viewport, side);
      // Measure, place, and measure again if a side placement made the card narrower and so taller.
      for (let pass = 0; pass < 2; pass++) {
        await nextTick();
        if (version !== generation || !card.value) return;
        const measured = card.value.getBoundingClientRect();
        const placed = tooltipPlacement(anchor(), measured.width, measured.height, viewport, side);
        position.value = placed;
        if (placed.width >= measured.width) break;
      }
      ready.value = true;
    }
    watch(() => [props.open, props.anchor, props.at?.x, props.at?.y, props.side, props.title, props.description, props.shortcut], place, { immediate: true });
    const dismiss = () => emit('dismiss');
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss(); };
    onMounted(() => {
      window.addEventListener('blur', dismiss);
      window.addEventListener('resize', dismiss);
      window.addEventListener('scroll', dismiss, true);
      window.addEventListener('keydown', key, true);
    });
    onUnmounted(() => {
      generation++;
      window.removeEventListener('blur', dismiss);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('keydown', key, true);
    });
    function head() {
      const keys = props.shortcut ? h('span', { class: 'tavora-tooltip-keys' }, shortcutKeys(props.shortcut).map(key => h('kbd', key))) : null;
      if (props.title) return [h('div', { class: 'tavora-tooltip-head' }, [h('h2', props.title), keys]), props.description ? h('p', wrappable(props.description)) : null];
      // A one-line hint is its own label: the text takes the title's place beside the keys.
      if (keys && props.description) return [h('div', { class: 'tavora-tooltip-head' }, [h('p', wrappable(props.description)), keys])];
      return [props.description ? h('p', wrappable(props.description)) : null];
    }
    return () => h(Teleport, { to: 'body' }, props.open ? [h('section', {
      id: props.id, ref: card, role: 'tooltip', 'data-slot': 'tooltip', 'data-side': position.value.side, 'data-tone': props.tone,
      class: props.compact ? 'tavora-tooltip compact' : 'tavora-tooltip',
      style: { left: position.value.left + 'px', top: position.value.top + 'px', maxWidth: position.value.width + 'px', '--tavora-tooltip-arrow': position.value.arrow + 'px', visibility: ready.value ? 'visible' : 'hidden' },
    }, [...head(), slots.default?.(), h('span', { class: 'tavora-tooltip-arrow', 'aria-hidden': 'true' })])] : []);
  },
});
