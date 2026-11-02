<script setup lang="ts">
import { NumberField } from "@tavora/official-ui/components/ui/number-field";
import { ref } from "vue";

defineProps<{ disabled?: boolean }>();

const copies = ref(10);
</script>

<template>
  <div class="flex flex-col gap-2">
    <NumberField v-model="copies" :min="1" :max="99" label="Copies" decrease-label="One less" increase-label="One more" :disabled="disabled" />
    <span class="text-muted-foreground text-xs tabular-nums">{{ copies }} copies</span>
  </div>
</template>
