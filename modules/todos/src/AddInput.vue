<script setup lang="ts">
// A quiet input that adds what was typed on Enter and stays ready for the next one.
// With `maxLevel`, Tab and Shift+Tab indent it so the next to-do becomes a sub-to-do.
import { Plus } from "@lucide/vue";
import { cn } from "@tavora/official-ui";
import { ref } from "vue";

const props = defineProps<{
  placeholder: string;
  label?: string;
  class?: string;
  maxlength?: number;
  outlined?: boolean;
  /** Lines the + up with task checkboxes and the text with task titles (TaskRow). */
  alignToTasks?: boolean;
  /** How deep Tab may indent the input; leave out for an input that does not indent. */
  maxLevel?: number;
}>();
const emit = defineEmits<{ add: [text: string, level: number] }>();
const level = defineModel<number>("level", { default: 0 });
const value = ref("");
const input = ref<HTMLInputElement | null>(null);

function submit() {
  const text = value.value.trim();
  if (!text) return;
  emit("add", text, Math.min(level.value, props.maxLevel ?? 0));
  value.value = "";
}

function onKey(event: KeyboardEvent) {
  if (event.key === "Escape" && value.value) {
    event.stopPropagation();
    value.value = "";
  }
  // Only a Tab that changes the level is taken; at either end it moves focus as usual.
  if (event.key === "Tab" && props.maxLevel !== undefined) {
    const current = Math.min(level.value, props.maxLevel);
    const next = event.shiftKey ? current - 1 : current + 1;
    if (next < 0 || next > props.maxLevel) return;
    event.preventDefault();
    level.value = next;
  }
}

defineExpose({ focus: () => input.value?.focus() });
</script>

<template>
  <form
    :class="cn('relative flex items-center', props.class)"
    :style="maxLevel !== undefined ? { paddingLeft: `${Math.min(level, maxLevel) * 24}px` } : undefined"
    @submit.prevent="submit"
  >
    <span class="relative flex w-full items-center">
      <Plus :class="cn('text-muted-foreground pointer-events-none absolute size-4', alignToTasks ? 'left-[50px]' : 'left-2')" :stroke-width="1.5" aria-hidden="true" />
      <input
        ref="input"
        v-model="value"
        :placeholder="placeholder"
        :aria-label="label ?? placeholder"
        :maxlength="maxlength"
        :class="
          cn(
            'placeholder:text-muted-foreground focus-visible:border-ring h-8 w-full min-w-0 rounded-md border bg-transparent pr-2 text-sm outline-none',
            alignToTasks ? 'pl-[74px]' : 'pl-8',
            outlined ? 'border-input bg-card' : 'hover:bg-accent/60 focus-visible:bg-background border-transparent',
          )
        "
        @keydown="onKey"
      />
    </span>
  </form>
</template>
