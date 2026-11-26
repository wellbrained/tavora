<script setup lang="ts">
import { SwitchField } from "@tavora/official-ui/components/ui/switch";
import { ref } from "vue";

const keep = ref(true);
const plan = ref(false);
</script>

<template>
  <div class="flex max-w-sm flex-col gap-1">
    <SwitchField v-model="keep" label="Keep finished to-dos" placement="end" data-testid="switch-field-end" />
    <SwitchField v-model="plan" label="Plan with unlocked" description="Only recipes you have unlocked." placement="end" />
    <SwitchField :model-value="true" label="Locked by your admin" placement="end" disabled disabled-reason="Ask your admin to change it." />
  </div>
</template>
