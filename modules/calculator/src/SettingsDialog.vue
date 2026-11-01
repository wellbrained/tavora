<script setup lang="ts">
// The Calculator's settings. Tavora shows them as a dialog over the workspace (`page`: the panel itself is that dialog,
// so this is its whole page); an older Tavora gets a dialog in the middle of the panel.
import { Button } from "@tavora/official-ui/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@tavora/official-ui/components/ui/dialog";
import { t } from "./i18n";
import SettingsRows from "./SettingsRows.vue";

defineProps<{ short: boolean; page?: boolean }>();
const emit = defineEmits<{ "update:short": [on: boolean]; close: [] }>();
const decimals = defineModel<string>("decimals", { required: true });
const historyLength = defineModel<string>("historyLength", { required: true });
</script>

<template>
  <div v-if="page" class="flex h-full min-h-0 flex-col gap-4 p-4" data-testid="settings-dialog">
    <h2 class="text-lg font-semibold">{{ t("options.title") }}</h2>
    <div class="min-h-0 flex-1 overflow-y-auto">
      <SettingsRows v-model:decimals="decimals" v-model:history-length="historyLength" :short="short" @update:short="(on: boolean) => emit('update:short', on)" />
    </div>
    <div class="flex justify-end">
      <Button data-testid="settings-done" @click="emit('close')">{{ t("done") }}</Button>
    </div>
  </div>
  <Dialog v-else :open="true" @update:open="(open: boolean) => !open && emit('close')">
    <DialogContent class="gap-4 sm:max-w-[360px]" data-testid="settings-dialog">
      <DialogHeader>
        <DialogTitle class="text-lg">{{ t("options.title") }}</DialogTitle>
      </DialogHeader>
      <SettingsRows v-model:decimals="decimals" v-model:history-length="historyLength" :short="short" @update:short="(on: boolean) => emit('update:short', on)" />
      <div class="flex justify-end">
        <Button data-testid="settings-done" @click="emit('close')">{{ t("done") }}</Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
