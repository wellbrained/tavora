<script setup lang="ts">
import { Checkbox } from "@tavora/official-ui/components/ui/checkbox";
import { Label } from "@tavora/official-ui/components/ui/label";
import { ref } from "vue";

defineProps<{ disabled?: boolean }>();

const done = ref(false);
</script>

<template>
  <Label>
    <Checkbox v-model="done" :disabled="disabled" />
    <span :class="['tavora-strike', done && 'text-muted-foreground']" :data-struck="done || undefined">Craft the boss weapon</span>
  </Label>
</template>
