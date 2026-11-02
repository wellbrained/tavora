<script setup lang="ts">
import { SwitchField } from "@tavora/official-ui/components/ui/switch";
import { ref } from "vue";

const showFinished = ref(true);
const startOnHome = ref(false);
</script>

<template>
  <div class="flex flex-col gap-2">
    <SwitchField v-model="showFinished" label="Show finished to-dos" description="Done to-dos stay in the list, crossed out." data-testid="switch-field" />
    <SwitchField v-model="startOnHome" label="Start on Home" />
    <SwitchField :model-value="true" label="Locked by your admin" disabled />
  </div>
</template>
