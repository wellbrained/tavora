<script setup lang="ts">
// A quiet input that adds what was typed on Enter and stays ready for the next one.
import { Plus } from "@lucide/vue";
import { cn } from "@tavora/official-ui";
import { ref } from "vue";

const props = defineProps<{ placeholder: string; label?: string; class?: string; maxlength?: number; outlined?: boolean }>();
const emit = defineEmits<{ add: [text: string] }>();
const value = ref("");
const input = ref<HTMLInputElement | null>(null);

function submit() {
  const text = value.value.trim();
  if (!text) return;
  emit("add", text);
  value.value = "";
}

function onKey(event: KeyboardEvent) {
  if (event.key === "Escape" && value.value) {
    event.stopPropagation();
    value.value = "";
  }
}

defineExpose({ focus: () => input.value?.focus() });
</script>

<template>
  <form :class="cn('relative flex items-center', props.class)" @submit.prevent="submit">
    <Plus class="text-muted-foreground pointer-events-none absolute left-2 size-4" :stroke-width="1.5" aria-hidden="true" />
    <input
      ref="input"
      v-model="value"
      :placeholder="placeholder"
      :aria-label="label ?? placeholder"
      :maxlength="maxlength"
      :class="
        cn(
          'placeholder:text-muted-foreground focus-visible:border-ring h-8 w-full min-w-0 rounded-md border bg-transparent pr-2 pl-8 text-sm outline-none',
          outlined ? 'border-input bg-card' : 'hover:bg-accent/60 focus-visible:bg-background border-transparent',
        )
      "
      @keydown="onKey"
    />
  </form>
</template>
