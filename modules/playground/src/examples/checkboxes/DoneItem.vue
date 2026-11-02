<script setup lang="ts">
import { Checkbox } from "@tavora/official-ui/components/ui/checkbox";
import { Label } from "@tavora/official-ui/components/ui/label";
import { ref } from "vue";
import { useOff } from "../../dev";

const off = useOff();
const struck = ref(false);
</script>

<template>
  <Label><Checkbox v-model="struck" :disabled="off" /> <span :class="['tavora-strike', struck && 'text-muted-foreground']" :data-struck="struck || undefined">Craft the boss weapon</span></Label>
</template>
