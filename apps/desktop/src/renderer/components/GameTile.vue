<script setup lang="ts">
// A game's tile in the Add a game picker: its own icon when this PC has one, else the rail's coloured initials.
import { computed, ref, watch } from "vue";
import { badgeLook, LETTER } from "../badge";
import { backdropOf } from "../icon-tone";
import { initials } from "../lib/game-picker";

const props = withDefaults(defineProps<{ id: string; name: string; icon?: string | null; size?: number }>(), { icon: null, size: 28 });
const look = computed(() => badgeLook(props.id));
const text = computed(() => initials(props.name));
// A picture that cannot be shown falls back to the initials.
const failed = ref(false);
watch(
  () => props.icon,
  () => (failed.value = false),
);
</script>

<template>
  <span
    class="relative inline-flex flex-none overflow-hidden shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]"
    :style="{ width: `${size}px`, height: `${size}px`, borderRadius: `${Math.round(size / 4)}px` }"
    aria-hidden="true"
  >
    <span v-if="icon && !failed" class="flex size-full items-center justify-center" :style="{ backgroundImage: backdropOf('onDark') }">
      <img class="object-contain" style="width: 84%; height: 84%" :src="icon" alt="" draggable="false" @error="failed = true" />
    </span>
    <span
      v-else
      class="flex size-full items-center justify-center font-semibold tracking-tight"
      :style="{
        color: LETTER,
        backgroundColor: look.color,
        backgroundImage: look.image,
        backgroundSize: look.size,
        fontSize: `${Math.max(10, Math.round(size * ([...text].length > 2 ? 0.3 : 0.38)))}px`,
      }"
      >{{ text }}</span
    >
  </span>
</template>
