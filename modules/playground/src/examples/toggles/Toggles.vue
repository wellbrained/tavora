<script setup lang="ts">
import { Toggle } from "@tavora/official-ui/components/ui/toggle";
import { ref } from "vue";

defineProps<{ disabled?: boolean }>();

const bold = ref(true);
const italic = ref(false);
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Toggle v-model="bold" label="Bold" class="font-bold" :disabled="disabled">B</Toggle>
    <Toggle v-model="italic" label="Italic" class="font-serif italic" :disabled="disabled">I</Toggle>
  </div>
</template>
