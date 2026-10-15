<script setup lang="ts">
// The small icon in front of a module's name. Modules that stand for a
// product (Discord, React, Vue, ...) show its real logo; the built-in ones
// a plain line icon.
import { Globe, ListTodo, NotebookPen } from "@lucide/vue";
import { computed } from "vue";
import { BRAND_LOGOS } from "../module-icons";

const props = withDefaults(defineProps<{ moduleId: string | undefined; size?: string }>(), { size: "size-4" });

const LINE_ICONS = { "tavora.browser": Globe, "tavora.notes": NotebookPen, "tavora.todos": ListTodo } as const;
const line = computed(() => LINE_ICONS[props.moduleId as keyof typeof LINE_ICONS]);
const logo = computed(() => BRAND_LOGOS[props.moduleId ?? ""]);
</script>

<template>
  <svg
    v-if="logo"
    :class="`${size} flex-none`"
    :style="logo.color ? { color: logo.color } : undefined"
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
    data-testid="module-icon"
  >
    <path :d="logo.path" />
  </svg>
  <component :is="line" v-else-if="line" :class="`text-muted-foreground ${size} flex-none`" :stroke-width="1.5" aria-hidden="true" data-testid="module-icon" />
</template>
