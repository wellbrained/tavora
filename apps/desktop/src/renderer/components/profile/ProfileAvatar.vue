<script setup lang="ts">
import { User } from "@lucide/vue";
import { computed } from "vue";

// The player's round avatar: their picture, else their initials in gold,
// else a person icon until they set a name.
const props = withDefaults(defineProps<{ name: string; pictureUrl: string | null; size?: number }>(), { size: 36 });

const initials = computed(() => {
  const words = props.name.trim().split(/\s+/).filter(Boolean);
  const picked = words.length > 1 ? [words[0]!, words[words.length - 1]!] : words;
  return picked.map((word) => [...word][0]!.toLocaleUpperCase()).join("");
});
</script>

<template>
  <span
    class="bg-muted inline-flex flex-none items-center justify-center overflow-hidden rounded-full shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]"
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
