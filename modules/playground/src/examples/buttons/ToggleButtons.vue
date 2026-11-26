<script setup lang="ts">
import { Bold, Italic, Underline } from "@lucide/vue";
import { Toggle } from "@tavora/official-ui/components/ui/toggle";
import { ref } from "vue";

const bold = ref(true);
const italic = ref(false);
const underline = ref(false);
</script>

<template>
  <div class="bg-background inline-flex gap-0.5 rounded-lg border p-0.5">
    <Toggle v-model="bold" variant="ghost" size="sm" label="Bold"><Bold /></Toggle>
    <Toggle v-model="italic" variant="ghost" size="sm" label="Italic"><Italic /></Toggle>
    <Toggle v-model="underline" variant="ghost" size="sm" label="Underline"><Underline /></Toggle>
  </div>
</template>
