<script setup lang="ts">
// Asks for a name: a new or renamed plan or world.
import { Button } from "@tavora/official-ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@tavora/official-ui/components/ui/dialog";
import { Input } from "@tavora/official-ui/components/ui/input";
import { ref } from "vue";
import { t } from "../../i18n";

const MAX_NAME = 120;

const props = defineProps<{ title: string; description?: string; initial: string; confirm: string }>();
const emit = defineEmits<{ apply: [name: string]; cancel: [] }>();

const value = ref(props.initial);

function submit() {
  const name = value.value.trim().slice(0, MAX_NAME);
  if (name) emit("apply", name);
}
</script>

<template>
  <Dialog :open="true" @update:open="(open: boolean) => !open && emit('cancel')">
    <DialogContent class="top-[12vh] translate-y-0 gap-4 sm:max-w-[420px]" data-testid="name-dialog" :show-close-button="false">
      <DialogHeader>
        <DialogTitle class="text-lg">{{ title }}</DialogTitle>
        <DialogDescription :class="description ? '' : 'sr-only'">{{ description ?? title }}</DialogDescription>
      </DialogHeader>
      <form class="flex flex-col gap-2" @submit.prevent="submit">
        <Input v-model="value" :aria-label="t('dialog.name')" :maxlength="MAX_NAME" autofocus data-testid="name-input" @focus="($event.target as HTMLInputElement).select()" />
        <div class="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" @click="emit('cancel')">{{ t("cancel") }}</Button>
          <Button type="submit" :disabled="!value.trim()" data-testid="name-submit">{{ confirm }}</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>
</template>
