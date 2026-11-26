<script setup lang="ts">
// A button that stays pressed, such as Bold, Pin or Show history. Several of them side by side stay separate buttons;
// for a joined row of them use ToggleGroup, for one choice out of several SegmentedControl.
// An icon alone makes it square: give it a `label`, which becomes its name and its tooltip. With words in it (an icon and
// a word, or just a word) it is as wide as the words. `label` stays its name for screen readers either way (also when a
// narrow panel hides the words), and is its tooltip unless the words already say it.
// `variant` is `outline` (an edge, the default) or `ghost` (no edge, for a toolbar or a bar over content); `size` is the
// kit's scale. Off with a `disabledReason`, it stays hoverable and focusable and the reason shows beside it, like a Button.
// In a kit Toolbar it is one of the arrow-key stops, and a switched-off one stays reachable there, like a Button.
import { Toggle } from "reka-ui";
import { useSlots, type HTMLAttributes } from "vue";
import { ACTIVATE_KEYS, useSoftDisabled } from "../../../lib/soft-disabled";
import { cn } from "../../../lib/utils";
import { slotText } from "./slot-text";
import { toggleVariants, type ToggleVariants } from "./variants";
import { useToolbarJoin } from "../toolbar/context";
import ToolbarItem from "../toolbar/ToolbarItem.vue";

defineOptions({ inheritAttrs: false });
const props = withDefaults(
  defineProps<{
    /** Its name for screen readers, and its tooltip unless its words already say it. */
    label?: string;
    variant?: NonNullable<ToggleVariants["variant"]>;
    size?: NonNullable<ToggleVariants["size"]>;
    disabled?: boolean;
    /** Why it is off. While `disabled` the toggle stays hoverable and focusable, and the reason shows in a tooltip beside it. */
    disabledReason?: string;
    class?: HTMLAttributes["class"];
  }>(),
  { variant: "outline", size: "default", disabled: false },
);
const model = defineModel<boolean>({ default: false });
const slots = useSlots();

const { joined } = useToolbarJoin();
const soft = useSoftDisabled(() => ({ disabled: props.disabled, reason: props.disabledReason, hinted: joined.value }), { keys: ACTIVATE_KEYS });

/** The words it shows; none means an icon alone. Read while rendering, so it follows the slot. */
const shown = () => slotText(slots.default?.()).trim();
/** The tooltip: the label, unless the words already say it. */
const tip = (words: string) => (props.label && props.label.trim().toLowerCase() !== words.toLowerCase() ? props.label : undefined);
</script>

<template>
  <ToolbarItem :join="joined">
    <Toggle
      v-model="model"
      data-slot="toggle"
      :data-variant="variant"
      :data-size="size"
      :title="tip(shown())"
      :aria-label="label || undefined"
      v-bind="soft.attrs()"
      :data-disabled="joined && soft.soft() ? undefined : soft.attrs()['data-disabled'] ?? (soft.disabled() ? '' : undefined)"
      :disabled="!!soft.disabled()"
      :class="cn(toggleVariants({ variant, size, iconOnly: shown() === '' }), props.class)"
    >
      <slot />
    </Toggle>
  </ToolbarItem>
</template>
