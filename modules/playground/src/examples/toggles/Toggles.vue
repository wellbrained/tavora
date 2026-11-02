<script setup lang="ts">
import { Toggle } from "@tavora/official-ui/components/ui/toggle";
import { ref } from "vue";
import { useOff } from "../../dev";

const off = useOff();
const bold = ref(true);
const italic = ref(false);
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Toggle v-model="bold" label="Bold" class="font-bold" :disabled="off">B</Toggle>
    <Toggle v-model="italic" label="Italic" class="font-serif italic" :disabled="off">I</Toggle>
  </div>
</template>
