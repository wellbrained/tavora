<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Checkbox } from "@tavora/official-ui/components/ui/checkbox";
import { Input } from "@tavora/official-ui/components/ui/input";
import { cn } from "@/lib/utils";
import { confirmAction, showToast, state, submitAction } from "../../host";
import { t } from "../../i18n";
import WorkspaceIcon from "../WorkspaceIcon.vue";
import SettingGroup from "./SettingGroup.vue";

// Settings > Games > Workspaces: every workspace in one list, to move many to Trash at once
// (a Steam import can add hundreds). Shift-click ticks a run of workspaces. The
// Steam import is on Games.
defineProps<{ highlight: string | null }>();

const filter = ref("");
const ticked = ref(new Set<string>());
/** The row clicked last, where a Shift-click run starts. */
let anchor: string | null = null;

const workspaces = computed(() =>
  Object.values(state.value!.library.workspaces)
    .sort((a, b) => a.name.localeCompare(b.name)),
);
const shown = computed(() => {
  const text = filter.value.trim().toLowerCase();
  return text ? workspaces.value.filter((workspace) => workspace.name.toLowerCase().includes(text)) : workspaces.value;
});
// Workspaces that left the library (removed elsewhere) are no longer selected.
watch(workspaces, (now) => {
  const live = new Set(now.map((workspace) => workspace.id));
  if ([...ticked.value].some((id) => !live.has(id))) ticked.value = new Set([...ticked.value].filter((id) => live.has(id)));
});
const selected = computed(() => workspaces.value.filter((workspace) => ticked.value.has(workspace.id)));
const allShown = computed(() => shown.value.length > 0 && shown.value.every((workspace) => ticked.value.has(workspace.id)));
const someShown = computed(() => !allShown.value && shown.value.some((workspace) => ticked.value.has(workspace.id)));

/** Ticks or clears a workspace; with Shift, the run from the workspace clicked last. */
function toggle(id: string, shift: boolean) {
  const on = !ticked.value.has(id);
  const next = new Set(ticked.value);
  const ids = shown.value.map((workspace) => workspace.id);
  const from = anchor === null ? -1 : ids.indexOf(anchor);
  const to = ids.indexOf(id);
  const run = shift && from !== -1 ? ids.slice(Math.min(from, to), Math.max(from, to) + 1) : [id];
  for (const each of run) {
    if (on) next.add(each);
    else next.delete(each);
  }
  ticked.value = next;
  anchor = id;
}

/** Ticks or clears every workspace the filter shows, leaving the others as they are. */
function tickShown(on: boolean) {
  const next = new Set(ticked.value);
  for (const workspace of shown.value) {
    if (on) next.add(workspace.id);
    else next.delete(workspace.id);
  }
  ticked.value = next;
}

function removeSelected() {
  const workspaceIds = selected.value.map((workspace) => workspace.id);
  if (!workspaceIds.length) return;
  confirmAction({
    title: t("settings.workspaces.removeTitle", { count: workspaceIds.length }),
    message: t("settings.workspaces.removeMessage"),
    confirm: t("settings.workspaces.remove"),
    danger: true,
    run: async () => {
      const error = await submitAction({ type: "trash-workspaces", workspaceIds });
      if (error) return error;
      ticked.value = new Set();
      showToast(t("settings.workspaces.removed", { count: workspaceIds.length }));
      return null;
    },
  });
}
</script>

<template>
  <SettingGroup :title="t('settings.workspaces.listTitle')">
    <div :class="cn('-mx-5 border-b px-5 py-4 transition-colors duration-500 last:border-b-0', highlight === 'workspaces' && 'bg-primary/10')" data-setting="workspaces">
      <p class="text-muted-foreground text-sm">{{ t("settings.workspaces.intro") }}</p>
    </div>
    <p v-if="!workspaces.length" class="text-muted-foreground py-4 text-sm" data-testid="workspaces-empty">{{ t("settings.workspaces.empty") }}</p>
    <template v-else>
      <div class="py-3">
        <Input v-model="filter" :placeholder="t('steamImport.filter')" :aria-label="t('settings.workspaces.filterLabel')" autocomplete="off" maxlength="80" data-testid="workspaces-filter" />
      </div>
      <div class="bg-card sticky top-0 z-[5] -mx-5 flex min-h-12 flex-wrap items-center gap-3 border-y px-5 py-2">
        <label class="flex flex-1 cursor-pointer items-center gap-3">
          <Checkbox
            :model-value="allShown ? true : someShown ? 'indeterminate' : false"
            :disabled="!shown.length"
            data-testid="workspaces-select-all"
            @update:model-value="tickShown($event === true)"
          />
          <span>{{ t("settings.workspaces.selectAll") }}</span>
        </label>
        <span class="text-muted-foreground text-sm tabular-nums" data-testid="workspaces-selected">{{ t("settings.workspaces.selected", { count: selected.length }) }}</span>
        <Button variant="danger" :disabled="!selected.length" data-testid="workspaces-remove" @click="removeSelected">
          {{ t("settings.workspaces.remove") }}
        </Button>
      </div>
      <ul class="-mx-5" :aria-label="t('settings.workspaces.list')" data-testid="workspaces-list">
        <li v-for="workspace in shown" :key="workspace.id">
          <!-- The whole row ticks; the click of the box itself lands here too, so it counts once. -->
          <div class="hover:bg-accent flex min-h-14 cursor-pointer items-center gap-4 px-5 py-2 select-none" @click="toggle(workspace.id, $event.shiftKey)">
            <Checkbox :model-value="ticked.has(workspace.id)" :aria-label="workspace.name" :data-testid="`workspaces-tick-${workspace.id}`" />
            <WorkspaceIcon :workspace="workspace" :size="32" />
            <span class="min-w-0 flex-1 truncate">{{ workspace.name }}</span>
          </div>
        </li>
        <li v-if="!shown.length" class="text-muted-foreground px-5 py-4 text-sm">{{ t("steamImport.noMatch") }}</li>
      </ul>
    </template>
  </SettingGroup>
</template>
