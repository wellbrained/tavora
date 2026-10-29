<script setup lang="ts">
// A quiet input that adds what was typed on Enter and stays ready for the next one.
// With `maxLevel`, Tab and Shift+Tab indent it so the next to-do becomes a sub-to-do.
// As a `draft` (a new to-do between others) it takes the focus when it appears, and Enter
// on an empty line, Esc or clicking elsewhere closes it; what was typed is kept on a click elsewhere.
import { Plus } from "@lucide/vue";
import { cn } from "@tavora/official-ui";
import { nextTick, onMounted, ref } from "vue";

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
  /** How far Shift+Tab may take it back. */
  minLevel?: number;
  draft?: boolean;
}>();
const emit = defineEmits<{ add: [text: string, level: number]; close: [] }>();
const level = defineModel<number>("level", { default: 0 });
const value = ref("");
const input = ref<HTMLInputElement | null>(null);
/** Set while an added to-do is drawn above, so a focus lost meanwhile does not close the draft. */
let adding = false;

const shownLevel = () => Math.max(Math.min(level.value, props.maxLevel ?? 0), props.minLevel ?? 0);

async function submit() {
  const text = value.value.trim();
  if (!text) {
    if (props.draft) emit("close");
    return;
  }
  adding = true;
  emit("add", text, shownLevel());
  value.value = "";
  await nextTick();
  adding = false;
  if (props.draft) input.value?.focus();
}

function onKey(event: KeyboardEvent) {
  if (event.key === "Escape" && (value.value || props.draft)) {
    event.stopPropagation();
    value.value = "";
    if (props.draft) emit("close");
  }
  // Only a Tab that changes the level is taken; at either end it moves focus as usual.
  if (event.key === "Tab" && props.maxLevel !== undefined) {
    const current = shownLevel();
    const next = event.shiftKey ? current - 1 : current + 1;
    if (next < (props.minLevel ?? 0) || next > props.maxLevel) return;
    event.preventDefault();
    level.value = next;
  }
}

function onFocusOut() {
  if (!props.draft || adding) return;
  const text = value.value.trim();
  value.value = "";
  if (text) emit("add", text, shownLevel());
  emit("close");
}

onMounted(() => props.draft && input.value?.focus());

defineExpose({ focus: () => input.value?.focus() });
</script>

<template>
  <form
    :class="cn('relative flex items-center', props.class)"
    :style="maxLevel !== undefined ? { paddingLeft: `${shownLevel() * 24}px` } : undefined"
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
            alignToTasks ? 'pl-[79px]' : 'pl-8',
            outlined ? 'border-input bg-card' : 'hover:bg-accent/60 focus-visible:bg-background border-transparent',
          )
        "
        @keydown="onKey"
        @focusout="onFocusOut"
      />
    </span>
  </form>
</template>
