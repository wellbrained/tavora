<script setup lang="ts">
import { RadioField } from "@tavora/official-ui/components/ui/radio-field";
import { RadioGroup } from "@tavora/official-ui/components/ui/radio-group";
import { ref } from "vue";

const density = ref("normal");
</script>

<template>
  <RadioGroup v-model="density" class="max-w-60 gap-0.5">
    <RadioField value="compact" label="Compact" />
    <RadioField value="normal" label="Normal" />
    <RadioField value="roomy" label="Roomy" />
  </RadioGroup>
</template>
