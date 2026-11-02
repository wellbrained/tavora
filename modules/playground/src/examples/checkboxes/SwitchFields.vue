<script setup lang="ts">
import { SwitchField } from "@tavora/official-ui/components/ui/switch";
import { ref } from "vue";
import { useOff } from "../../dev";

const off = useOff();
const notify = ref(true);
const quiet = ref(false);
</script>

<template>
  <div class="flex flex-col gap-2">
    <SwitchField v-model="notify" label="Show finished to-dos" description="Done to-dos stay in the list, crossed out." data-testid="switch-field" :disabled="off" />
    <SwitchField v-model="quiet" label="Start on Home" :disabled="off" />
    <SwitchField :model-value="true" label="Locked by your admin" disabled />
  </div>
</template>
