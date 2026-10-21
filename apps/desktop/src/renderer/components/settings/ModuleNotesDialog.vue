<script setup lang="ts">
// A module's patch notes in a dialog over Settings > Modules, opened by its Patch notes button.
// The notes themselves come from ModuleNotes.vue, which also marks them seen.
import { X } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@tavora/official-ui/components/ui/dialog";
import { state } from "../../host";
import { t } from "../../i18n";
import ModuleIcon from "../ModuleIcon.vue";
import ModuleNotes from "./ModuleNotes.vue";

defineProps<{ module: NonNullable<typeof state.value>["modules"][number] }>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <Dialog :open="true" @update:open="(open: boolean) => !open && emit('close')">
    <DialogContent
      class="bg-card flex max-h-[calc(100vh-48px)] w-[min(640px,calc(100vw-48px))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
      :data-testid="`module-notes-dialog-${module.id}`"
      :show-close-button="false"
      :aria-describedby="undefined"
    >
      <header class="flex items-center gap-3 border-b px-6 py-4">
        <span class="bg-primary/10 border-primary/20 text-primary flex size-10 flex-none items-center justify-center rounded-lg border" aria-hidden="true">
          <ModuleIcon :module-id="module.id" size="size-5" />
        </span>
        <div class="flex min-w-0 flex-1 flex-col">
          <DialogTitle class="truncate text-lg font-semibold">{{ t("settings.modules.notesTitle", { name: module.name }) }}</DialogTitle>
          <span class="text-muted-foreground text-sm tabular-nums">{{ module.version }}</span>
        </div>
        <Button variant="ghost" size="icon" class="flex-none" :aria-label="t('common.close')" :title="t('common.close')" @click="emit('close')"><X :stroke-width="1.5" /></Button>
      </header>
      <div class="min-h-0 flex-1 overflow-y-auto p-6">
        <ModuleNotes :module-id="module.id" :version="module.version" :unseen="module.notes.unseen" />
      </div>
    </DialogContent>
  </Dialog>
</template>
