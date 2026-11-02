<script setup lang="ts">
import { Label } from "@tavora/official-ui/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@tavora/official-ui/components/ui/radio-group";
import { ref } from "vue";
import { useOff } from "../../dev";

const off = useOff();
const radio = ref("normal");
</script>

<template>
  <RadioGroup v-model="radio" :disabled="off">
    <Label><RadioGroupItem value="compact" /> Compact</Label>
    <Label><RadioGroupItem value="normal" /> Normal</Label>
    <Label><RadioGroupItem value="roomy" /> Roomy</Label>
  </RadioGroup>
</template>
