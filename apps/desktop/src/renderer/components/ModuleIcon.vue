<script setup lang="ts">
// The small icon in front of a module's name. The module's own icon (its
// manifest `icon`) comes first; then, for the modules that stand for a
// product (Discord, React, Vue, ...), its real logo, or a plain line icon
// for the built-in ones; any other module gets a puzzle piece.
import { Gauge, Globe, ListTodo, NotebookPen, Puzzle } from "@lucide/vue";
import { computed } from "vue";
import { state } from "../host";
import { BRAND_LOGOS } from "../module-icons";

const props = withDefaults(defineProps<{ moduleId: string | undefined; size?: string }>(), { size: "size-4" });

const LINE_ICONS = { "tavora.ai-usage": Gauge, "tavora.browser": Globe, "tavora.notes": NotebookPen, "tavora.todos": ListTodo } as const;
const picture = computed(() => state.value?.modules.find((module) => module.id === props.moduleId)?.icon ?? null);
const logo = computed(() => BRAND_LOGOS[props.moduleId ?? ""]);
const line = computed(() => LINE_ICONS[props.moduleId as keyof typeof LINE_ICONS] ?? Puzzle);
</script>

<template>
  <img v-if="picture" :src="picture" :class="`${size} flex-none rounded-[3px] object-contain`" alt="" aria-hidden="true" data-testid="module-icon" />
  <svg
    v-else-if="logo"
    :class="`${size} flex-none`"
    :style="logo.color ? { color: logo.color } : undefined"
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
    data-testid="module-icon"
  >
    <path :d="logo.path" />
  </svg>
  <component :is="line" v-else :class="`text-muted-foreground ${size} flex-none`" :stroke-width="1.5" aria-hidden="true" data-testid="module-icon" />
</template>
