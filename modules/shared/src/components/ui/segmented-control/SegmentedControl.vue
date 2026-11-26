<script setup lang="ts" generic="T extends string">
import { useTemplateRef, type HTMLAttributes } from "vue";
import { RadioGroupItem, RadioGroupRoot } from "reka-ui";
import type { ControlSize } from "../../../lib/control-size";
import { cn } from "../../../lib/utils";
import { useSlidingIndicator } from "../sliding-indicator";
import { isSoftOption, optionHint, type SegmentedOption } from "./options";
import { useToolbarJoin } from "../toolbar/context";
import ToolbarItem from "../toolbar/ToolbarItem.vue";

// A row of mutually exclusive choices, for two to four short options. It is
// a radio group, so arrow keys move between the options.
// One pill sits behind the picked option and slides to a new one when you click; it jumps when the arrow keys
// pick, and it is not shown while nothing is picked or the control is disabled.
// An option can have an icon (alone, with `iconOnly`), be off by itself (`disabled`) and carry a tooltip. Its tooltip is
// its `title`, which the kit turns into its tooltip beside the option, as for a Button. A disabled option with a
// `disabledReason` (or a `tooltip`) is "soft", like a Button with a title: it stays hoverable and focusable so the text can
// be read, the arrow keys land on it without picking it, and it takes no click. Without one it is plainly disabled.
// In a kit Toolbar its options join the toolbar's arrow keys: there the arrows only move the focus, and Space or Enter
// picks, so moving along the toolbar never changes the choice.
// `class` is merged, so a caller can place the control (`absolute top-2 left-2`) over the root's own `relative`.
const props = withDefaults(
  defineProps<{
    options: SegmentedOption<T>[];
    label: string;
    disabled?: boolean;
    /** The kit's size scale: the control is as tall as a Button of the same size. */
    size?: ControlSize;
    /** Fills the width it is given: the options share it equally, and a long label (German, say) still takes the room it needs. */
    fill?: boolean;
    class?: HTMLAttributes["class"];
  }>(),
  { size: "default", fill: false },
);
const model = defineModel<T>({ required: true });
const emit = defineEmits<{
  /** The reader picked an option, also the one that is shown already (`v-model` only says a change). For a value that is stored as a newer version's and shown as this option. */
  pick: [value: T];
}>();

const root = useTemplateRef("root");
// A soft option (aria-disabled) counts as off too, so it gets no pill.
useSlidingIndicator(root, { selector: '[role="radio"][data-state="checked"]:not([data-disabled]):not([aria-disabled="true"])' });

const { joined } = useToolbarJoin(() => {
  const at: unknown = root.value;
  return at instanceof Element ? at : (at as { $el?: Element } | null)?.$el;
});

// The options sit inside the control's 1px edge and 2px padding, so each is 6px under the size's height.
const ITEM_SIZE: Record<ControlSize, string> = {
  sm: "h-[calc(var(--style-control-height,32px)-10px)] px-2.5",
  default: "h-[calc(var(--style-control-height,32px)-6px)] px-3",
  lg: "h-[calc(var(--style-control-height,32px)+2px)] px-4",
};
const rootClass = () => cn("bg-background group/segmented relative inline-flex flex-none gap-0.5 rounded-lg border p-0.5", props.fill && "flex w-full min-w-0", props.class);
const itemClass = (option: SegmentedOption<T>) =>
  cn(
    "text-muted-foreground hover:text-foreground focus-visible:outline-ring data-[state=checked]:text-primary relative rounded-sm border border-transparent text-sm font-medium whitespace-nowrap transition-[color] group-data-[indicator=jump]/segmented:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-(--disabled-opacity)",
    "aria-disabled:hover:text-muted-foreground aria-disabled:cursor-default aria-disabled:opacity-(--disabled-opacity)",
    ITEM_SIZE[props.size],
    (option.icon || props.fill) && "inline-flex items-center justify-center gap-1.5 [&_svg]:pointer-events-none [&_svg]:shrink-0",
    option.icon && option.iconOnly && "px-2",
    props.fill && "flex-1 px-1.5",
  );
/** Plainly off (no tooltip to read): skipped by the arrows and not clickable. */
const hardOff = (option: SegmentedOption<T>) => !!props.disabled || (!!option.disabled && !isSoftOption(option, props.disabled));

/** Every way to a pick (click, Space, an arrow key landing) ends here, so a disabled option can't be picked. */
function pick(value: unknown) {
  const option = props.options.find((candidate) => candidate.value === value);
  if (!option || option.disabled) return;
  model.value = option.value;
  emit("pick", option.value);
}
</script>

<template>
  <div v-if="joined" ref="root" role="radiogroup" data-slot="segmented-control" :aria-label="label" :aria-disabled="disabled ? 'true' : undefined" :data-disabled="disabled ? '' : undefined" :class="rootClass()">
    <span aria-hidden="true" data-slot="segmented-pill" class="tavora-indicator border-primary/50 bg-primary/15 rounded-sm border" data-testid="segmented-pill" />
    <ToolbarItem v-for="option in options" :key="option.value" join :focusable="!hardOff(option)">
      <button
        type="button"
        role="radio"
        :aria-checked="model === option.value"
        :data-state="model === option.value ? 'checked' : 'unchecked'"
        :disabled="hardOff(option)"
        :data-disabled="hardOff(option) ? '' : undefined"
        :aria-disabled="isSoftOption(option, disabled) ? 'true' : undefined"
        :aria-label="option.iconOnly && option.icon ? option.label : undefined"
        :title="optionHint(option)"
        data-slot="segmented-item"
        :data-testid="option.testid"
        :class="itemClass(option)"
        @click="pick(option.value)"
      >
        <component :is="option.icon" v-if="option.icon" class="size-4" aria-hidden="true" />
        <template v-if="!(option.icon && option.iconOnly)">{{ option.label }}</template>
      </button>
    </ToolbarItem>
  </div>
  <RadioGroupRoot v-else ref="root" data-slot="segmented-control" :model-value="model" orientation="horizontal" :aria-label="label" :disabled="disabled" :class="rootClass()" @update:model-value="pick">
    <span aria-hidden="true" data-slot="segmented-pill" class="tavora-indicator border-primary/50 bg-primary/15 rounded-sm border" data-testid="segmented-pill" />
    <RadioGroupItem
      v-for="option in options"
      :key="option.value"
      :value="option.value"
      :disabled="option.disabled && !isSoftOption(option, disabled)"
      :aria-disabled="isSoftOption(option, disabled) ? 'true' : undefined"
      :aria-label="option.iconOnly && option.icon ? option.label : undefined"
      :title="optionHint(option)"
      data-slot="segmented-item"
      :data-testid="option.testid"
      :class="itemClass(option)"
    >
      <component :is="option.icon" v-if="option.icon" class="size-4" aria-hidden="true" />
      <template v-if="!(option.icon && option.iconOnly)">{{ option.label }}</template>
    </RadioGroupItem>
  </RadioGroupRoot>
</template>
