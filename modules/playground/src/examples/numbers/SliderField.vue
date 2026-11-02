<script setup lang="ts">
import { SliderField } from "@tavora/official-ui/components/ui/slider";
import { ref } from "vue";

defineProps<{ disabled?: boolean }>();

const opacity = ref(70);
</script>

<template>
  <SliderField v-model="opacity" :min="0" :max="100" :step="5" unit="%" label="Opacity" class="max-w-56" :disabled="disabled" />
</template>
