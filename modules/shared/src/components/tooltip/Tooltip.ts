import { defineComponent, h, Teleport, nextTick, onMounted, onUnmounted, ref, watch, type PropType } from 'vue';
import { tooltipPosition, type TooltipPoint } from './geometry';
import { TOOLTIP_TOKENS } from './typography';
import './tooltip.css';

/** Presentational hover card shared by Vue, React and vanilla module adapters. */
export default defineComponent({
  name: 'Tooltip',
  props: {
    open: { type: Boolean, required: true },
    at: { type: Object as PropType<TooltipPoint>, required: true },
    title: { type: String, required: true },
    description: String,
    id: String,
  },
  emits: ['dismiss'],
  setup(props, { emit, slots }) {
    const card = ref<HTMLElement | null>(null);
    const position = ref({ left: 0, top: 0, width: 320 });
    const ready = ref(false);
    let generation = 0;
    async function place() {
      const version = ++generation;
      if (!props.open) { ready.value = false; return; }
      await nextTick();
      if (version !== generation || !card.value) return;
      const first = tooltipPosition(props.at, 0, 0, { width: innerWidth, height: innerHeight });
      position.value = first;
      await nextTick();
      if (version !== generation || !card.value) return;
      position.value = tooltipPosition(props.at, first.width, card.value.getBoundingClientRect().height, { width: innerWidth, height: innerHeight });
      ready.value = true;
    }
    watch(() => [props.open, props.at.x, props.at.y, props.title, props.description], place, { immediate: true });
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
    return () => h(Teleport, { to: 'body' }, props.open ? [h('section', {
      id: props.id, ref: card, role: 'tooltip', 'data-slot': 'tooltip', class: 'tavora-tooltip',
      style: [TOOLTIP_TOKENS, { left: position.value.left + 'px', top: position.value.top + 'px', width: position.value.width + 'px', visibility: ready.value ? 'visible' : 'hidden' }],
    }, [props.title ? h('h2', props.title) : null, props.description ? h('p', props.description) : null, slots.default?.()])] : []);
  },
});
