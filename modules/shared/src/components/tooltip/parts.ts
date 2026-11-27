// Freestanding pieces of a card, for a card you put together yourself: in the panel's Tooltip (or a ZoomTip) and in an
// ItemCard's slot, between the item card's own parts. Each takes plain values, not a whole TooltipContent, and reads the
// tooltip's tokens (tooltip.css), which an ItemCard sets to its own colours, so a part looks right in both.
import { defineComponent, h, type Component, type PropType, type VNode } from 'vue';
import { uiText } from '../ui/text';

/** A run of text: `accent` in the accent colour (a number, a keyword), `strong` bold, `italic` slanted. */
export interface TooltipTextRun {
  text: string;
  accent?: boolean;
  strong?: boolean;
  italic?: boolean;
}

/** The runs as inline elements. A "\n" in a run's text is a line break (the text keeps its line breaks). */
export function renderRuns(runs: readonly TooltipTextRun[]): (VNode | string)[] {
  return runs.map(run => {
    let node: VNode | string = run.text;
    if (run.italic) node = h('em', node);
    if (run.strong) node = h('strong', node);
    if (run.accent) node = h('span', { 'data-accent': '' }, [node]);
    return node;
  });
}

/**
 * A paragraph: one `text`, or `runs` with accented, bold or italic parts and line breaks. `tone="muted"` is the softer
 * text (a note, "You have 2 of these."), `size="small"` the small size, `box` the item card's effect box around it.
 */
export const TooltipText = defineComponent({
  name: 'TooltipText',
  props: {
    text: String,
    runs: Array as PropType<TooltipTextRun[]>,
    tone: { type: String as PropType<'default' | 'muted'>, default: 'default' },
    size: { type: String as PropType<'default' | 'small'>, default: 'default' },
    box: Boolean,
  },
  setup(props, { slots }) {
    return () => {
      const content = props.runs?.length ? renderRuns(props.runs) : props.text ?? slots.default?.();
      return h('p', { class: 'tavora-tooltip-text', 'data-slot': 'tooltip-text', 'data-tone': props.tone === 'muted' ? 'muted' : undefined, 'data-size': props.size === 'small' ? 'small' : undefined, 'data-box': props.box ? '' : undefined }, content);
    };
  },
});

/** A small heading over the part under it (a list, tags, rows), such as "Found in". */
export const TooltipHeading = defineComponent({
  name: 'TooltipHeading',
  props: { text: String },
  setup(props, { slots }) {
    return () => h('h4', { class: 'tavora-tooltip-heading', 'data-slot': 'tooltip-heading' }, props.text ?? slots.default?.());
  },
});

/** A tag: a text, and optionally its own colour ("#rrggbb" only, for a game's rarity) for its text and edge. */
export type TooltipTag = string | { text: string; color?: string };
const HEX = /^#[0-9a-fA-F]{6}$/;

/** A row of tags in the outline badge's look, such as a kind and a rarity. */
export const TooltipTags = defineComponent({
  name: 'TooltipTags',
  props: { tags: { type: Array as PropType<TooltipTag[]>, required: true } },
  setup(props) {
    return () => props.tags.length ? h('ul', { class: 'tavora-tooltip-tags', 'data-slot': 'tooltip-tags' }, props.tags.map(tag => {
      const { text, color } = typeof tag === 'string' ? { text: tag, color: undefined } : tag;
      return h('li', { class: 'tavora-tooltip-badge', style: color && HEX.test(color) ? { color, borderColor: color } : undefined }, text);
    })) : null;
  },
});

/** A line of a list: its text, and a short `meta` at the right (a count, a status, "Common"). */
export type TooltipListItem = string | { text: string; meta?: string };

/** A list with bullets, each line's `meta` at the right: places, drops, requirements. */
export const TooltipList = defineComponent({
  name: 'TooltipList',
  props: { items: { type: Array as PropType<TooltipListItem[]>, required: true } },
  setup(props) {
    return () => props.items.length ? h('ul', { class: 'tavora-tooltip-list', 'data-slot': 'tooltip-list' }, props.items.map(item => {
      const { text, meta } = typeof item === 'string' ? { text: item, meta: undefined } : item;
      return h('li', [h('span', text), meta ? h('span', meta) : null]);
    })) : null;
  },
});

/** A small picture in a row: a URL your page can load, or a Lucide icon; `label` is its name for screen readers, `count` a badge at its corner. */
export interface TooltipIcon {
  image?: string;
  icon?: Component;
  label: string;
  count?: string;
}

/** The name a screen reader hears for a picture with a count ("Steel Coat, 95"), in the language shown. */
export const iconLabel = (label: string, count?: string): string => count ? uiText.value.iconCount.replace('{label}', label).replace('{count}', count) : label;

/** A row of small pictures (spells, buffs, items carried), each with an optional count at its corner. */
export const TooltipIcons = defineComponent({
  name: 'TooltipIcons',
  props: { icons: { type: Array as PropType<TooltipIcon[]>, required: true } },
  setup(props) {
    return () => props.icons.length ? h('div', { class: 'tavora-tooltip-icons', 'data-slot': 'tooltip-icons' }, props.icons.map(icon => h('span', { class: 'tavora-tooltip-icon', role: 'img', 'aria-label': iconLabel(icon.label, icon.count) }, [
      icon.image ? h('img', { src: icon.image, alt: '' }) : icon.icon ? h(icon.icon, { 'aria-hidden': 'true' }) : null,
      icon.count ? h('span', { class: 'tavora-tooltip-icon-count', 'aria-hidden': 'true' }, icon.count) : null,
    ]))) : null;
  },
});

/**
 * The card's head as a band across its top: a picture at the left (`image`, or the `art` slot for pictures laid over each
 * other, such as a frame and an icon), the title and a line under it (`subtitle`, such as a state or a level). Use it
 * instead of the Tooltip's `title`. A game colours it with a class that sets `--tavora-tooltip-band`.
 */
export const TooltipArt = defineComponent({
  name: 'TooltipArt',
  props: { title: { type: String, required: true }, subtitle: String, image: String },
  setup(props, { slots }) {
    return () => {
      const art = slots.art?.() ?? (props.image ? [h('img', { src: props.image, alt: '' })] : null);
      return h('header', { class: 'tavora-tooltip-art', 'data-slot': 'tooltip-art' }, [
        art ? h('span', { class: 'tavora-tooltip-art-picture', 'aria-hidden': 'true' }, art) : null,
        h('div', { class: 'tavora-tooltip-art-text' }, [h('h3', props.title), props.subtitle || slots.subtitle ? h('p', slots.subtitle?.() ?? props.subtitle) : null]),
      ]);
    };
  },
});

/** A line across the card's bottom, under a line: a cost, where it comes from, a hint. `text`, or your own in the slot (a `<strong>` label). */
export const TooltipFooter = defineComponent({
  name: 'TooltipFooter',
  props: { text: String },
  setup(props, { slots }) {
    return () => h('footer', { class: 'tavora-tooltip-footer', 'data-slot': 'tooltip-footer' }, props.text ?? slots.default?.());
  },
});
