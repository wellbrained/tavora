<script setup lang="ts">
// Helpers for checking the kit, off by default: once on, they show below the switch.
import { SwitchField } from "@tavora/official-ui/components/ui/switch";
import { t } from "./i18n";

const on = defineModel<boolean>("on", { required: true });
const disabled = defineModel<boolean>("disabled", { required: true });
</script>

<template>
  <div class="flex flex-col gap-3">
    <SwitchField v-model="on" :label="t('dev.title')" data-testid="dev-tools" />
    <SwitchField v-if="on" v-model="disabled" :label="t('dev.disabled')" class="pl-4" data-testid="disable-all" />
  </div>
</template>
