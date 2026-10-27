<script setup lang="ts">
import { User } from "@lucide/vue";
import { computed } from "vue";
import { autoInitials } from "./initials";

// The user's round avatar: their picture, else their initials in gold
// (their own or taken from the name), else a person icon.
const props = withDefaults(
  defineProps<{ name: string; pictureUrl: string | null; size?: number; initials?: string; square?: boolean }>(),
  { size: 36, initials: "", square: false },
);

const initials = computed(() => props.initials.trim() || autoInitials(props.name));
</script>

<template>
  <span
    :class="square ? 'rounded-[10px]' : 'bg-muted rounded-full'"
    class="inline-flex flex-none items-center justify-center overflow-hidden shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]"
    :style="{ width: `${size}px`, height: `${size}px` }"
    aria-hidden="true"
  >
    <img v-if="pictureUrl" class="size-full object-cover" :src="pictureUrl" alt="" draggable="false" />
    <span v-else-if="initials" class="text-primary font-semibold" :style="{ fontSize: `${Math.max(12, Math.round(size * 0.38))}px` }">
      {{ initials }}
    </span>
    <User v-else class="text-muted-foreground" :style="{ width: `${size * 0.5}px`, height: `${size * 0.5}px` }" :stroke-width="1.5" />
  </span>
</template>
