<script setup lang="ts">
import { Pin } from "@lucide/vue";
import { Toggle } from "@tavora/official-ui/components/ui/toggle";
import { ref } from "vue";

const on = ref(true);
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Toggle v-model="on" size="sm"><Pin /> Small</Toggle>
    <Toggle v-model="on"><Pin /> Default</Toggle>
    <Toggle v-model="on" size="lg"><Pin /> Large</Toggle>
  </div>
</template>
