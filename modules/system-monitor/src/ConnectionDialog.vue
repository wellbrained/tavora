<script setup lang="ts">
// How the connection is watched: on or off, and which address Tavora pings next to your router. One dialog and one
// Save, because Tavora wants a click for what changes the whole PC. Tavora checks the address again before it keeps it.
import { errorMessage } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Checkbox } from "@tavora/official-ui/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@tavora/official-ui/components/ui/dialog";
import { Input } from "@tavora/official-ui/components/ui/input";
import { SYSTEM_PING_TARGET, type SystemConnectionSettings } from "@tavora/sdk";
import { ref } from "vue";
import { t } from "./i18n";
import { cleanTarget } from "./settings";

const props = defineProps<{ current: SystemConnectionSettings; save: (settings: SystemConnectionSettings) => Promise<void> }>();
const emit = defineEmits<{ done: []; cancel: [] }>();

const enabled = ref(props.current.enabled);
const value = ref(props.current.target);
const error = ref("");

// The save runs straight from the click (or Enter), with nothing awaited before it: Tavora counts that as the user's.
async function submit(): Promise<void> {
  const target = cleanTarget(value.value);
  if (!target) {
    error.value = t("target.invalid");
    return;
  }
  try {
    if (target !== props.current.target || enabled.value !== props.current.enabled) await props.save({ enabled: enabled.value, target });
    emit("done");
  } catch (reason) {
    error.value = t("target.error", { error: errorMessage(reason) });
  }
}
</script>

<template>
  <Dialog :open="true" @update:open="(open: boolean) => !open && emit('cancel')">
    <DialogContent class="top-[12vh] translate-y-0 gap-4 sm:max-w-[420px]" data-testid="target-dialog" :show-close-button="false">
      <DialogHeader>
        <DialogTitle class="text-lg">{{ t("target.title") }}</DialogTitle>
        <DialogDescription>{{ t("target.text") }}</DialogDescription>
      </DialogHeader>
      <form class="flex flex-col gap-3" @submit.prevent="submit">
        <label class="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox :model-value="enabled" data-testid="target-watch" @update:model-value="(next: boolean | 'indeterminate') => (enabled = next === true)" />
          {{ t("target.watch") }}
        </label>
        <Input v-model="value" data-testid="target-input" :placeholder="SYSTEM_PING_TARGET" :aria-label="t('target.label')" :aria-invalid="error ? true : undefined" autofocus @update:model-value="error = ''" />
        <p v-if="error" class="text-destructive text-sm" role="alert" data-testid="target-error">{{ error }}</p>
        <div class="mt-2 flex justify-end gap-2">
          <Button v-if="value !== SYSTEM_PING_TARGET" type="button" variant="secondary" class="mr-auto" data-testid="target-reset" @click="value = SYSTEM_PING_TARGET">{{ t("target.reset") }}</Button>
          <Button type="button" variant="secondary" @click="emit('cancel')">{{ t("target.cancel") }}</Button>
          <Button type="submit" data-testid="target-save">{{ t("target.save") }}</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>
</template>
