<script setup lang="ts" generic="T extends string">
// A row of toggle buttons that can each stay pressed, such as Bold, Italic and Underline.
// For buttons that should stay apart, use single Toggles; for one choice out of several, SegmentedControl.
// `outline` (the default) joins the buttons into one bar; `ghost` keeps them apart with a small gap and no edges.
// An option shows its icon, its `text`, or both; with neither, its label. Off by itself with a `disabledReason`, an option
// stays hoverable and focusable (the arrow keys land on it) and the reason shows beside it, but it can't be pressed.
import { ToggleGroupItem, ToggleGroupRoot } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { ACTIVATE_KEYS, isSoftDisabled, stopSoft } from "../../../lib/soft-disabled";
import { cn } from "../../../lib/utils";
import { REASON_ATTRIBUTE } from "../../../title-tooltips";
import type { ToggleGroupOption } from "./options";
import { toggleVariants, type ToggleVariants } from "./variants";
import { useToolbarJoin } from "../toolbar/context";
import ToolbarItem from "../toolbar/ToolbarItem.vue";

const props = withDefaults(
  defineProps<{
    options: ToggleGroupOption<T>[];
    /** The group's name for screen readers. */
    label: string;
    variant?: NonNullable<ToggleVariants["variant"]>;
    size?: NonNullable<ToggleVariants["size"]>;
    disabled?: boolean;
    class?: HTMLAttributes["class"];
  }>(),
  { variant: "outline", size: "default", disabled: false },
);
const model = defineModel<T[]>({ required: true });
/** In a kit Toolbar its buttons join the toolbar's arrow keys, instead of having arrow keys of their own. */
const { joined } = useToolbarJoin();

/** Off but still reachable: it has a reason, or it sits in a toolbar (where an off Button stays reachable too). */
const soft = (option: ToggleGroupOption<T>) => !props.disabled && isSoftDisabled({ disabled: option.disabled, reason: option.disabledReason, hinted: joined.value });
/** Plainly off: skipped by the arrow keys and not clickable. */
const hardOff = (option: ToggleGroupOption<T>) => props.disabled || (!!option.disabled && !soft(option));

const words = (option: ToggleGroupOption<T>) => (option.icon ? (option.text ?? "") : (option.text ?? option.label));
const tip = (option: ToggleGroupOption<T>) => (option.label.trim().toLowerCase() === words(option).trim().toLowerCase() ? undefined : option.label);

function softAttrs(option: ToggleGroupOption<T>): Record<string, unknown> {
  if (!soft(option)) return {};
  const reason = option.disabledReason?.trim();
  return {
    // No `data-disabled`: the arrow keys skip what has it, and a soft option stays one of their stops.
    "aria-disabled": "true",
    ...(reason ? { [REASON_ATTRIBUTE]: reason, "aria-description": reason } : {}),
    onClickCapture: stopSoft,
    onPointerdownCapture: stopSoft,
    onMousedownCapture: stopSoft,
    onKeydownCapture: (event: KeyboardEvent) => ACTIVATE_KEYS.has(event.key) && stopSoft(event),
  };
}

const joinedEdges = "rounded-none not-first:-ml-px first:rounded-l-md last:rounded-r-md focus-visible:z-20 data-[state=on]:z-10";
</script>

<template>
  <ToggleGroupRoot
    v-model="model"
    type="multiple"
    :roving-focus="!joined"
    :aria-label="label"
    :disabled="disabled"
    data-slot="toggle-group"
    :data-variant="variant"
    :data-size="size"
    :class="cn('inline-flex flex-none', variant === 'ghost' && 'gap-0.5', props.class)"
  >
    <ToolbarItem v-for="option in options" :key="option.value" :join="joined" :focusable="!hardOff(option)">
      <ToggleGroupItem
        :value="option.value"
        :aria-label="option.label"
        :title="tip(option)"
        :data-testid="option.testid"
        :disabled="hardOff(option)"
        v-bind="softAttrs(option)"
        :class="cn(toggleVariants({ variant, size, iconOnly: words(option) === '' }), variant === 'outline' && joinedEdges)"
      >
        <component :is="option.icon" v-if="option.icon" aria-hidden="true" />
        <span v-if="words(option)" aria-hidden="true">{{ words(option) }}</span>
      </ToggleGroupItem>
    </ToolbarItem>
  </ToggleGroupRoot>
</template>
