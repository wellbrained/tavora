<script setup lang="ts">
// Settings > Trash: removed workspaces, kept for 30 days. Tick several to restore or delete them together.
import { computed, ref, watch } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Checkbox } from "@tavora/official-ui/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { act, confirmAction, state, submitAction } from "../../host";
import { formatDate, t } from "../../i18n";
import WorkspaceIcon from "../WorkspaceIcon.vue";
import SettingGroup from "./SettingGroup.vue";

defineProps<{ highlight: string | null }>();

const library = computed(() => state.value!.library);

// Workspaces ticked to restore or delete together.
const trashTicked = ref(new Set<string>());
watch(
  () => library.value.trash,
  (trash) => {
    const there = new Set(trash.map((entry) => entry.workspace.id));
    if ([...trashTicked.value].some((id) => !there.has(id))) trashTicked.value = new Set([...trashTicked.value].filter((id) => there.has(id)));
  },
);
const trashAll = computed(() => library.value.trash.length > 0 && library.value.trash.every((entry) => trashTicked.value.has(entry.workspace.id)));

function tickTrash(id: string, on: boolean) {
  const next = new Set(trashTicked.value);
  if (on) next.add(id);
  else next.delete(id);
  trashTicked.value = next;
}

function tickAllTrash(on: boolean) {
  trashTicked.value = on ? new Set(library.value.trash.map((entry) => entry.workspace.id)) : new Set();
}

async function restoreTicked() {
  const workspaceIds = [...trashTicked.value];
  if (workspaceIds.length && (await act({ type: "restore-workspaces", workspaceIds })).ok) trashTicked.value = new Set();
}

function deleteTicked() {
  const workspaceIds = [...trashTicked.value];
  if (!workspaceIds.length) return;
  confirmAction({
    title: t("settings.trash.deleteManyTitle", { count: workspaceIds.length }),
    message: t("settings.trash.deleteManyMessage"),
    confirm: t("settings.trash.deleteConfirm"),
    danger: true,
    run: () => submitAction({ type: "delete-workspaces", workspaceIds }),
  });
}

function deleteNow(workspaceId: string, name: string) {
  confirmAction({
    title: t("settings.trash.deleteTitle", { name }),
    message: t("settings.trash.deleteMessage"),
    confirm: t("settings.trash.deleteConfirm"),
    danger: true,
    run: () => submitAction({ type: "delete-workspace", workspaceId }),
  });
}
</script>

<template>
  <p class="text-muted-foreground mb-6 text-sm">{{ t("settings.trash.description") }}</p>
  <SettingGroup data-testid="trash">
    <p v-if="!library.trash.length" class="text-muted-foreground py-4 text-sm" data-testid="trash-empty">{{ t("settings.trash.empty") }}</p>
    <template v-else>
      <div class="bg-card sticky top-0 z-[5] -mx-5 flex min-h-12 flex-wrap items-center gap-3 border-b px-5 py-2">
        <label class="flex flex-1 cursor-pointer items-center gap-3">
          <Checkbox
            :model-value="trashAll ? true : trashTicked.size > 0 ? 'indeterminate' : false"
            data-testid="trash-select-all"
            @update:model-value="tickAllTrash($event === true)"
          />
          <span>{{ t("settings.trash.selectAll") }}</span>
        </label>
        <span class="text-muted-foreground text-sm tabular-nums">{{ t("settings.workspaces.selected", { count: trashTicked.size }) }}</span>
        <Button variant="secondary" :disabled="!trashTicked.size" data-testid="trash-restore-selected" @click="restoreTicked">
          {{ t("settings.trash.restoreSelected") }}
        </Button>
        <Button variant="danger" :disabled="!trashTicked.size" data-testid="trash-delete-selected" @click="deleteTicked">
          {{ t("settings.trash.deleteSelected") }}
        </Button>
      </div>
      <ul>
        <li
          v-for="entry in library.trash"
          :key="entry.workspace.id"
          :class="
            cn(
              '-mx-5 flex min-h-16 flex-wrap items-center gap-x-4 gap-y-2 border-b px-5 py-3 transition-colors duration-500 last:border-b-0',
              highlight === `trash-${entry.workspace.id}` && 'bg-primary/10',
            )
          "
          :data-testid="`trash-${entry.workspace.id}`"
          :data-setting="`trash-${entry.workspace.id}`"
        >
          <Checkbox
            class="flex-none"
            :model-value="trashTicked.has(entry.workspace.id)"
            :aria-label="entry.workspace.name"
            :data-testid="`trash-tick-${entry.workspace.id}`"
            @update:model-value="tickTrash(entry.workspace.id, $event === true)"
          />
          <WorkspaceIcon :workspace="entry.workspace" :size="40" />
          <span class="flex min-w-0 flex-1 basis-40 flex-col gap-1">
            <span class="truncate font-medium">{{ entry.workspace.name }}</span>
            <span class="text-muted-foreground text-sm">{{ t("settings.trash.deleteOn", { date: formatDate(entry.purgeAt) }) }}</span>
          </span>
          <Button variant="secondary" :data-testid="`restore-${entry.workspace.id}`" @click="act({ type: 'restore-workspace', workspaceId: entry.workspace.id })">
            {{ t("settings.trash.restore") }}
          </Button>
          <Button variant="danger" :data-testid="`delete-${entry.workspace.id}`" @click="deleteNow(entry.workspace.id, entry.workspace.name)">
            {{ t("settings.trash.deleteNow") }}
          </Button>
        </li>
      </ul>
    </template>
  </SettingGroup>
</template>
