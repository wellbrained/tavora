<script setup lang="ts">
import { Label } from "@tavora/official-ui/components/ui/label";
import { Switch } from "@tavora/official-ui/components/ui/switch";
import { ref } from "vue";
import { useOff } from "../../dev";

const off = useOff();
const switchOn = ref(true);
const switchOff = ref(false);
</script>

<template>
  <div class="flex flex-col gap-2">
    <Label><Switch v-model="switchOn" :disabled="off" /> Show finished to-dos</Label>
    <Label><Switch v-model="switchOff" :disabled="off" /> Start on Home</Label>
  </div>
</template>
