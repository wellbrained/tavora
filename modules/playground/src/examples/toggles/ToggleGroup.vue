<script setup lang="ts">
import { AlignCenter, AlignLeft, AlignRight } from "@lucide/vue";
import { ToggleGroup } from "@tavora/official-ui/components/ui/toggle";
import { ref } from "vue";

const formats = ref<("bold" | "italic" | "underline")[]>(["bold"]);
const sides = ref<("left" | "center" | "right")[]>(["left"]);
</script>

<template>
  <div class="flex flex-wrap items-center gap-3">
    <ToggleGroup
      v-model="formats"
      label="Text style"
      :options="[
        { value: 'bold', label: 'Bold', text: 'B' },
        { value: 'italic', label: 'Italic', text: 'I' },
        { value: 'underline', label: 'Underline', text: 'U' },
      ]"
    />
    <ToggleGroup
      v-model="sides"
      variant="ghost"
      label="Line up"
      :options="[
        { value: 'left', label: 'Left', icon: AlignLeft },
        { value: 'center', label: 'Centre', icon: AlignCenter },
        { value: 'right', label: 'Right', icon: AlignRight, disabled: true, disabledReason: 'Only for text boxes.' },
      ]"
    />
  </div>
</template>
