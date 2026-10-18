<script setup lang="ts">
// Settings > Modules: what is installed and where it came from, and the
// player's own modules folder, the same way themes have theirs. Install from
// zip checks and unpacks a module zip into the folder; dropping a module
// package into the folder and pressing Reload adds it too. Remove moves it
// to the recycle bin. A module's data stays, so adding it again finds it.
// What module developers use (development folders, the examples) is in
// Settings > Development instead.
import { ArrowRightLeft, CloudDownload, FileArchive, FolderInput, FolderOpen, NotebookText, RefreshCw, Trash2 } from "@lucide/vue";
import { computed, ref } from "vue";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { act, confirmAction, dialog, gamesUsing, listOf, showToast, state, submitAction } from "../../host";
import { t } from "../../i18n";
import ModuleNotes from "./ModuleNotes.vue";
import ModuleRow from "./ModuleRow.vue";
import SettingRow from "./SettingRow.vue";

defineProps<{ highlight: string | null }>();

type ModuleView = NonNullable<typeof state.value>["modules"][number];

const modules = computed(() => state.value!.modules);
const problems = computed(() => state.value!.moduleProblems);
const leftover = computed(() => state.value!.leftoverModuleData);
const files = computed(() => state.value!.moduleFiles);
// Tavora's own modules first, then the player's; development modules are listed in Settings > Development.
const sorted = computed(() => {
  const rank = (module: ModuleView) => (module.provenance === "official" ? 0 : 1);
  return modules.value.filter((module) => !module.development).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
});

/** The module whose patch notes are open under its row, if any. */
const notesOpen = ref<string | null>(null);

/** Panels of a module that are open in the current game, so Remove can say what closes. */
function openCount(moduleId: string): number {
  return state.value!.panels.filter((panel) => panel.moduleId === moduleId).length;
}

async function install() {
  const result = await act({ type: "install-module" });
  if (!result.ok || !result.id) return;
  const module = modules.value.find((item) => item.id === result.id);
  if (!module) return;
  showToast(
    module.publisherName
      ? t("settings.modules.installedBy", { name: module.name, version: module.version, publisher: module.publisherName })
      : t("settings.modules.installed", { name: module.name, version: module.version }),
  );
}

/** Asks the catalog for updates of the modules installed from it now. */
const checking = ref(false);
async function checkUpdates() {
  checking.value = true;
  const result = await act({ type: "check-module-updates" });
  checking.value = false;
  if (!result.ok) return;
  const updated = result.updated ?? 0;
  const waiting = result.waiting ?? 0;
  showToast(updated + waiting === 0 ? t("settings.modules.updatesNone") : t("settings.modules.updatesFound", { updated: String(updated), waiting: String(waiting) }));
}

function moveLocal(module: ModuleView) {
  confirmAction({
    title: t("settings.modules.moveLocalTitle", { name: module.name }),
    message: t("settings.modules.moveLocalMessage", { name: module.name }),
    confirm: t("settings.modules.moveLocalConfirm"),
    run: () => submitAction({ type: "move-local-data", moduleId: module.id }),
  });
}

function deleteData(entry: { owner: string; moduleId: string }) {
  confirmAction({
    title: t("settings.modules.deleteDataTitle", { id: entry.moduleId }),
    message: t("settings.modules.deleteDataMessage"),
    confirm: t("settings.modules.deleteData"),
    danger: true,
    run: () => submitAction({ type: "delete-module-data", owner: entry.owner, moduleId: entry.moduleId }),
  });
}

function remove(module: ModuleView) {
  const games = gamesUsing(module);
  confirmAction({
    title: t("settings.modules.removeTitle", { name: module.name }),
    message: games.length ? t("settings.modules.removeMessageUsed", { games: listOf(games) }) : t("settings.modules.removeMessage"),
    confirm: t("common.remove"),
    danger: true,
    run: () => submitAction({ type: "remove-module", moduleId: module.id }),
  });
}
</script>

<template>
  <SettingRow
    :label="t('settings.own-modules.label')"
    :description="t('settings.own-modules.description')"
    setting="own-modules"
    :highlighted="highlight === 'own-modules'"
  >
    <span class="flex flex-none flex-wrap justify-end gap-2">
      <Button variant="secondary" data-testid="install-module" @click="install">
        <FileArchive :stroke-width="1.5" /> {{ t("settings.modules.install") }}
      </Button>
      <Button v-if="state!.library.onlineSearch" variant="secondary" data-testid="check-module-updates" :disabled="checking" @click="checkUpdates">
        <CloudDownload :stroke-width="1.5" /> {{ t("settings.modules.checkUpdates") }}
      </Button>
      <Button variant="secondary" data-testid="open-modules-folder" @click="act({ type: 'open-modules-folder' })">
        <FolderOpen :stroke-width="1.5" /> {{ t("common.openFolder") }}
      </Button>
      <Button variant="secondary" data-testid="reload-modules" @click="act({ type: 'reload-modules' })"><RefreshCw :stroke-width="1.5" /> {{ t("common.reload") }}</Button>
    </span>
  </SettingRow>
  <ul v-if="problems.length" class="-mt-2 mb-2 flex flex-col gap-1.5 py-2" :aria-label="t('settings.modules.problems')" data-testid="module-problems">
    <li v-for="problem in problems" :key="problem.folder" class="text-sm">
      <span class="text-destructive font-medium">{{ problem.folder }}</span>
      <span class="text-muted-foreground"> {{ t("settings.modules.problem", { folder: "", message: problem.message }).trim() }}</span>
    </li>
  </ul>

  <SettingRow
    :label="t('settings.module-files.label')"
    :description="t('settings.module-files.description')"
    setting="module-files"
    :highlighted="highlight === 'module-files'"
  >
    <span class="flex flex-none flex-wrap justify-end gap-2">
      <Button variant="secondary" data-testid="change-module-files" :disabled="files.moving" @click="act({ type: 'module-files-change' })">
        <FolderInput :stroke-width="1.5" /> {{ files.moving ? t("settings.module-files.moving") : t("settings.module-files.change") }}
      </Button>
      <Button variant="secondary" data-testid="open-module-files" @click="act({ type: 'module-files-open' })">
        <FolderOpen :stroke-width="1.5" /> {{ t("common.openFolder") }}
      </Button>
      <Button v-if="files.custom" variant="ghost" data-testid="reset-module-files" :disabled="files.moving" @click="act({ type: 'module-files-reset' })">
        {{ t("settings.module-files.default") }}
      </Button>
    </span>
  </SettingRow>
  <p :class="cn('-mt-2 mb-2 py-2 text-sm break-all', files.available ? 'text-muted-foreground' : 'text-destructive')" data-testid="module-files-path">
    {{ files.folder }}<template v-if="!files.available"> — {{ t("settings.module-files.missing") }}</template>
  </p>

  <div
    :class="cn('-mx-3 rounded-lg px-3 pt-4 transition-colors duration-500', highlight === 'installed-modules' && 'bg-primary/10')"
    data-setting="installed-modules"
  >
    <p class="font-medium">{{ t("settings.installed-modules.label") }}</p>
    <ul class="mt-2 flex flex-col" :aria-label="t('settings.installed-modules.label')" data-testid="module-list">
      <ModuleRow v-for="module in sorted" :key="module.id" :module="module">
        <Button
          v-if="module.update"
          variant="default"
          :data-testid="`module-update-${module.id}`"
          @click="dialog = { kind: 'grant', moduleId: module.id, slot: null, review: true, update: true }"
        >
          <CloudDownload :stroke-width="1.5" /> {{ t("settings.modules.update", { version: module.update.version }) }}
        </Button>
        <Button
          v-if="module.notes.latest"
          variant="ghost"
          :aria-expanded="notesOpen === module.id"
          :data-testid="`module-notes-toggle-${module.id}`"
          @click="notesOpen = notesOpen === module.id ? null : module.id"
        >
          <NotebookText :stroke-width="1.5" /> {{ t("settings.modules.notes") }}
          <span v-if="module.notes.unseen" class="bg-primary text-primary-foreground rounded-sm px-1.5 text-xs" :data-testid="`module-notes-new-${module.id}`">{{
            t("settings.modules.notesNew")
          }}</span>
        </Button>
        <Button
          v-if="module.localDataWaiting"
          variant="secondary"
          :data-testid="`move-local-data-${module.id}`"
          @click="moveLocal(module)"
        >
          <ArrowRightLeft :stroke-width="1.5" /> {{ t("settings.modules.moveLocal") }}
        </Button>
        <Button
          v-if="module.removable"
          variant="secondary"
          :aria-label="t('settings.modules.removeLabel', { name: module.name })"
          :title="openCount(module.id) ? t('settings.modules.removeHint') : undefined"
          :data-testid="`remove-module-${module.id}`"
          @click="remove(module)"
        >
          <Trash2 :stroke-width="1.5" /> {{ t("common.remove") }}
        </Button>
        <template v-if="notesOpen === module.id" #details>
          <ModuleNotes :module-id="module.id" :version="module.version" :unseen="module.notes.unseen" />
        </template>
      </ModuleRow>
    </ul>
  </div>

  <div v-if="leftover.length" class="pt-4" data-testid="leftover-data">
    <p class="font-medium">{{ t("settings.modules.leftover") }}</p>
    <p class="text-muted-foreground text-sm">{{ t("settings.modules.leftoverHint") }}</p>
    <ul class="mt-2 flex flex-col" :aria-label="t('settings.modules.leftover')">
      <li
        v-for="entry in leftover"
        :key="`${entry.owner}/${entry.moduleId}`"
        class="flex items-center gap-4 border-b py-3 last:border-b-0"
        :data-testid="`leftover-${entry.owner}-${entry.moduleId}`"
      >
        <span class="flex min-w-0 flex-1 items-center gap-2">
          <span class="truncate font-mono text-sm">{{ entry.moduleId }}</span>
          <span class="text-muted-foreground flex-none rounded-sm border px-1.5 text-xs" :class="entry.publisher && 'font-mono'" :title="entry.publisher ? t('settings.modules.publisherHint', { key: entry.publisher }) : undefined">
            {{ entry.publisher ? t("settings.modules.publisher", { short: entry.publisher.slice(0, 8) }) : t(`settings.modules.leftoverOwner.${entry.owner as "local" | "official"}`) }}
          </span>
        </span>
        <Button variant="secondary" :aria-label="t('settings.modules.deleteDataLabel', { id: entry.moduleId })" :data-testid="`delete-data-${entry.owner}-${entry.moduleId}`" @click="deleteData(entry)">
          <Trash2 :stroke-width="1.5" /> {{ t("settings.modules.deleteData") }}
        </Button>
      </li>
    </ul>
  </div>
</template>
