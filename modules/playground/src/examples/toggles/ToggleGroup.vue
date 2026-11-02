<script setup lang="ts">
import { ToggleGroup } from "@tavora/official-ui/components/ui/toggle";
import { ref } from "vue";

defineProps<{ disabled?: boolean }>();

const formats = ref<("bold" | "italic" | "underline")[]>(["bold"]);
</script>

<template>
  <ToggleGroup
    v-model="formats"
    label="Text style"
    :disabled="disabled"
    :options="[
      { value: 'bold', label: 'Bold', text: 'B' },
      { value: 'italic', label: 'Italic', text: 'I' },
      { value: 'underline', label: 'Underline', text: 'U' },
    ]"
  />
</template>
