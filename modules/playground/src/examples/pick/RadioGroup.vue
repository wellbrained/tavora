<script setup lang="ts">
import { Label } from "@tavora/official-ui/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@tavora/official-ui/components/ui/radio-group";
import { ref } from "vue";

const density = ref("normal");
</script>

<template>
  <RadioGroup v-model="density">
    <Label><RadioGroupItem value="compact" /> Compact</Label>
    <Label><RadioGroupItem value="normal" /> Normal</Label>
    <Label><RadioGroupItem value="roomy" /> Roomy</Label>
  </RadioGroup>
</template>
