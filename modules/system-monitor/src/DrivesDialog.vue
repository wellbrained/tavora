<script setup lang="ts">
// Which drives to watch. Lists every drive Tavora sees (internal, removable, network) plus any picked drive that is
// unplugged now. Saving stores the user's choice, so a drive that shows up later is not added on its own.
import { Button } from "@tavora/official-ui/components/ui/button";
import { Checkbox } from "@tavora/official-ui/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@tavora/official-ui/components/ui/dialog";
import type { SystemInfo } from "@tavora/sdk";
import { computed, ref } from "vue";
import { size } from "./format";
import { language, t } from "./i18n";

const props = defineProps<{ info: SystemInfo; checked: string[] }>();
const emit = defineEmits<{ save: [drives: string[]]; cancel: [] }>();

const draft = ref(new Set(props.checked));

const rows = computed(() => {
  const listed = props.info.drives.map((drive) => ({
    id: drive.id,
    label: drive.label,
    kind: drive.kind,
    total: drive.totalBytes,
    present: true,
  }));
  const gone = props.checked.filter((id) => !listed.some((drive) => drive.id === id)).map((id) => ({ id, label: "", kind: "other" as const, total: null, present: false }));
  return [...listed, ...gone];
});

function toggle(id: string, on: boolean): void {
  const next = new Set(draft.value);
  if (on) next.add(id);
  else next.delete(id);
  draft.value = next;
}

/** In the order the drives are listed, so the panel shows them the same way. */
const chosen = () => rows.value.map((row) => row.id).filter((id) => draft.value.has(id));

const detail = (row: (typeof rows.value)[number]) =>
  [t(row.kind === "other" ? "drives.unknown" : `drives.${row.kind}`), row.total ? size(row.total, language.value) : "", row.present ? "" : t("drives.notConnected")].filter(Boolean).join(" · ");
</script>

<template>
  <Dialog :open="true" @update:open="(open: boolean) => !open && emit('cancel')">
    <DialogContent class="top-[8vh] max-h-[84vh] translate-y-0 gap-3 overflow-y-auto sm:max-w-[380px]" data-testid="drives-dialog" :show-close-button="false">
      <DialogHeader>
        <DialogTitle class="text-lg">{{ t("drives.dialogTitle") }}</DialogTitle>
        <DialogDescription>{{ t("drives.dialogText") }}</DialogDescription>
      </DialogHeader>
      <ul class="flex flex-col">
        <li v-for="row in rows" :key="row.id">
          <label class="hover:bg-accent flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5" :data-testid="`pick-${row.id}`">
            <Checkbox :model-value="draft.has(row.id)" @update:model-value="(value: boolean | 'indeterminate') => toggle(row.id, value === true)" />
            <span class="font-medium">{{ row.id }}</span>
            <span class="min-w-0 flex-1 truncate">{{ row.label }}</span>
            <span class="text-muted-foreground flex-none text-xs">{{ detail(row) }}</span>
          </label>
        </li>
      </ul>
      <div class="flex justify-end gap-2">
        <Button type="button" variant="secondary" @click="emit('cancel')">{{ t("drives.cancel") }}</Button>
        <Button type="button" data-testid="drives-save" @click="emit('save', chosen())">{{ t("drives.save") }}</Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
