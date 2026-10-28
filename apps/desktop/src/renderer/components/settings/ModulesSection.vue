<script setup lang="ts">
// Settings > Modules: what is installed and where it came from, updates,
// removal and permissions. Browsing and adding is the module library's job;
// the More menu keeps the rarer ways in: Install from zip checks and unpacks
// a module zip into the user's modules folder (the same way themes have
// theirs); dropping a module package into the folder and pressing Reload
// adds it too. Remove moves it to the recycle bin. A module's data stays, so
// adding it again finds it. A module installed from the catalog can be
// reported to Tavora, and its patch notes open in a dialog. Below the list
// are the websites modules may reach, and where module files live. What
// module developers use (development folders, the examples) is in
// Settings > Development instead.
import { ArrowRightLeft, ChevronDown, CircleAlert, CloudDownload, Ellipsis, FileArchive, Flag, FolderInput, FolderOpen, NotebookText, RefreshCw, Store, Trash2 } from "@lucide/vue";
import { computed, ref } from "vue";
import { Badge } from "@tavora/official-ui/components/ui/badge";
import { Button } from "@tavora/official-ui/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@tavora/official-ui/components/ui/dropdown-menu";
import { Switch } from "@tavora/official-ui/components/ui/switch";
import { cn } from "@/lib/utils";
import { act, confirmAction, dialog, workspacesUsing, listOf, settingsOpen, showToast, state, submitAction } from "../../host";
import { problemText } from "../../../shared/module-problem";
import { t } from "../../i18n";
import ModuleGrantsSection from "./ModuleGrantsSection.vue";
import ModuleNotesDialog from "./ModuleNotesDialog.vue";
import ModuleRow from "./ModuleRow.vue";
import SettingGroup from "./SettingGroup.vue";
import SettingRow from "./SettingRow.vue";

defineProps<{ highlight: string | null }>();

type ModuleView = NonNullable<typeof state.value>["modules"][number];

const modules = computed(() => state.value!.modules);
const problems = computed(() => state.value!.moduleProblems);
const leftover = computed(() => state.value!.leftoverModuleData);
const files = computed(() => state.value!.moduleFiles);
// Tavora's own modules first, then the user's; development modules are listed in Settings > Development.
const sorted = computed(() => {
  const rank = (module: ModuleView) => (module.provenance === "official" ? 0 : 1);
  return modules.value.filter((module) => !module.development).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
});

/** The module whose patch notes dialog is open, if any. */
const notesOpen = ref<string | null>(null);
const notesModule = computed(() => modules.value.find((module) => module.id === notesOpen.value) ?? null);

/** Leaves Settings for the module library, on Tavora's catalog. */
function openLibrary() {
  settingsOpen.value = false;
  dialog.value = { kind: "add-module", view: "catalog" };
}

/** Panels of a module that are open in the current workspace, so Remove can say what closes. */
function openCount(moduleId: string): number {
  return state.value!.panels.filter((panel) => panel.moduleId === moduleId).length;
}

/** Report is for modules from the catalog, and only while online search is on. */
const canReport = (module: ModuleView) => module.fromCatalog && state.value!.library.onlineSearch;
/** Whether a module has anything for its ⋯ menu. */
const hasMore = (module: ModuleView) => module.localDataWaiting || canReport(module) || module.removable;

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

const autoUpdateModules = computed({
  get: () => state.value!.library.autoUpdateModules,
  set: (enabled: boolean) => void act({ type: "set-auto-update-modules", enabled }),
});

/** Asks the catalog for updates of the modules installed from it now. */
const checking = ref(false);
async function checkUpdates() {
  checking.value = true;
  const result = await act({ type: "check-module-updates" });
  checking.value = false;
  if (!result.ok) return;
  const updated = result.updated ?? 0;
  const waiting = result.waiting ?? 0;
  if (updated + waiting === 0) showToast(t("settings.modules.updatesNone"));
  // Nothing installed: they were only found, and wait for the user.
  else if (updated === 0) showToast(t("settings.modules.updatesWaiting", { count: waiting }));
  else showToast(t("settings.modules.updatesFound", { updated: String(updated), waiting: String(waiting) }));
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

function report(module: ModuleView) {
  dialog.value = { kind: "report-module", moduleId: module.id, name: module.name };
}

function remove(module: ModuleView) {
  const workspaces = workspacesUsing(module);
  confirmAction({
    title: t("settings.modules.removeTitle", { name: module.name }),
    message: workspaces.length ? t("settings.modules.removeMessageUsed", { workspaces: listOf(workspaces) }) : t("settings.modules.removeMessage"),
    confirm: t("common.remove"),
    danger: true,
    run: () => submitAction({ type: "remove-module", moduleId: module.id }),
  });
}
</script>

<template>
  <SettingGroup v-if="problems.length" :title="t('settings.modules.problems')">
    <ul class="flex flex-col" :aria-label="t('settings.modules.problems')" aria-live="polite" data-testid="module-problems">
      <li v-for="problem in problems" :key="problem.path" class="flex flex-wrap items-start gap-x-4 gap-y-3 border-b py-4 last:border-b-0">
        <div class="flex min-w-0 flex-1 basis-56 items-start gap-4">
          <CircleAlert class="text-warning mt-0.5 size-4 flex-none" :stroke-width="1.5" aria-hidden="true" />
          <div class="flex min-w-0 flex-1 flex-col gap-2">
            <p class="text-sm leading-relaxed [overflow-wrap:anywhere]">
              <span class="font-medium">{{ problem.folder }}</span>{{ " " }}
              <span class="text-muted-foreground">{{ problemText(t, "modules", problem.kind, problem.values) }}</span>
            </p>
            <p class="text-muted-foreground text-xs [overflow-wrap:anywhere]" data-testid="module-problem-path">{{ problem.path }}</p>
          </div>
        </div>
        <Button
          variant="secondary"
          class="flex-none"
          :aria-label="[t('common.openFolder'), problem.folder].join(': ')"
          :data-testid="`open-module-problem-${problem.folder}`"
          @click="act({ type: 'open-module-problem-folder', path: problem.path })"
        >
          <FolderOpen :stroke-width="1.5" /> {{ t("common.openFolder") }}
        </Button>
      </li>
    </ul>
  </SettingGroup>

  <SettingGroup :title="t('settings.installed-modules.label')">
    <SettingRow
      :label="t('settings.own-modules.label')"
      :description="t('settings.own-modules.description')"
      setting="own-modules"
      :highlighted="highlight === 'own-modules'"
    >
      <span class="flex max-w-full flex-none flex-wrap items-center justify-end gap-2">
        <Button v-if="state!.library.onlineSearch" variant="secondary" data-testid="check-module-updates" :disabled="checking" @click="checkUpdates">
          <CloudDownload :stroke-width="1.5" /> {{ t("settings.modules.checkUpdates") }}
        </Button>
        <!-- Browsing and adding live in the module library; the rarer ways in sit behind More. -->
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="secondary" :aria-label="t('settings.modules.moreLabel')" data-testid="modules-more">
              {{ t("common.more") }} <ChevronDown :stroke-width="1.5" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem data-testid="open-module-library" @select="openLibrary">
              <Store :stroke-width="1.5" /> {{ t("settings.modules.library") }}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem data-testid="install-module" @select="install">
              <FileArchive :stroke-width="1.5" /> {{ t("settings.modules.install") }}
            </DropdownMenuItem>
            <DropdownMenuItem data-testid="open-modules-folder" @select="act({ type: 'open-modules-folder' })">
              <FolderOpen :stroke-width="1.5" /> {{ t("common.openFolder") }}
            </DropdownMenuItem>
            <DropdownMenuItem data-testid="reload-modules" @select="act({ type: 'reload-modules' })">
              <RefreshCw :stroke-width="1.5" /> {{ t("common.reload") }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </SettingRow>
    <SettingRow
      :label="t('settings.auto-update-modules.label')"
      :description="t('settings.auto-update-modules.description')"
      setting="auto-update-modules"
      :highlighted="highlight === 'auto-update-modules'"
    >
      <Switch v-model="autoUpdateModules" :aria-label="t('settings.auto-update-modules.label')" data-testid="auto-update-modules" />
    </SettingRow>
    <div :class="cn('-mx-5 px-5 transition-colors duration-500', highlight === 'installed-modules' && 'bg-primary/10')" data-setting="installed-modules">
      <ul class="flex flex-col" :aria-label="t('settings.installed-modules.label')" data-testid="module-list">
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
            aria-haspopup="dialog"
            :data-testid="`module-notes-toggle-${module.id}`"
            @click="notesOpen = module.id"
          >
            <NotebookText :stroke-width="1.5" /> {{ t("settings.modules.notes") }}
            <Badge v-if="module.notes.unseen" class="py-0 font-normal" :data-testid="`module-notes-new-${module.id}`">{{
              t("settings.modules.notesNew")
            }}</Badge>
          </Button>
          <DropdownMenu v-if="hasMore(module)">
            <DropdownMenuTrigger as-child>
              <Button
                variant="ghost"
                size="icon-sm"
                class="flex-none"
                :aria-label="t('common.moreActions')"
                :title="t('common.moreActions')"
                :data-testid="`module-more-${module.id}`"
              >
                <Ellipsis :stroke-width="1.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem v-if="module.localDataWaiting" :data-testid="`move-local-data-${module.id}`" @select="moveLocal(module)">
                <ArrowRightLeft :stroke-width="1.5" /> {{ t("settings.modules.moveLocal") }}
              </DropdownMenuItem>
              <DropdownMenuItem
                v-if="canReport(module)"
                :aria-label="t('settings.modules.reportLabel', { name: module.name })"
                :title="t('catalog.reportHint')"
                :data-testid="`report-module-${module.id}`"
                @select="report(module)"
              >
                <Flag :stroke-width="1.5" /> {{ t("settings.modules.report") }}
              </DropdownMenuItem>
              <DropdownMenuItem
                v-if="module.removable"
                variant="destructive"
                :aria-label="t('settings.modules.removeLabel', { name: module.name })"
                :title="openCount(module.id) ? t('settings.modules.removeHint') : undefined"
                :data-testid="`remove-module-${module.id}`"
                @select="remove(module)"
              >
                <Trash2 :stroke-width="1.5" /> {{ t("common.remove") }}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ModuleRow>
      </ul>
    </div>
  </SettingGroup>
  <ModuleNotesDialog v-if="notesModule" :key="notesModule.id" :module="notesModule" @close="notesOpen = null" />

  <ModuleGrantsSection :highlight="highlight" />

  <SettingGroup :title="t('settings.heading.files')">
    <SettingRow
      :label="t('settings.module-files.label')"
      :description="t('settings.module-files.description')"
      setting="module-files"
      :highlighted="highlight === 'module-files'"
    >
      <template #below>
        <p :class="cn('mt-1 font-mono text-xs break-all', files.available ? 'text-muted-foreground' : 'text-destructive')" data-testid="module-files-path">
          {{ files.folder }}<template v-if="!files.available"> — {{ t("settings.module-files.missing") }}</template>
        </p>
      </template>
      <span class="flex max-w-full flex-none flex-wrap items-center justify-end gap-2">
        <Button variant="secondary" data-testid="change-module-files" :disabled="files.moving" @click="act({ type: 'module-files-change' })">
          <FolderInput :stroke-width="1.5" /> {{ files.moving ? t("settings.module-files.moving") : t("settings.module-files.change") }}
        </Button>
        <Button variant="secondary" size="icon-sm" data-testid="open-module-files" :aria-label="t('common.openFolder')" :title="t('common.openFolder')" @click="act({ type: 'module-files-open' })">
          <FolderOpen :stroke-width="1.5" />
        </Button>
        <Button v-if="files.custom" variant="ghost" data-testid="reset-module-files" :disabled="files.moving" @click="act({ type: 'module-files-reset' })">
          {{ t("settings.module-files.default") }}
        </Button>
      </span>
    </SettingRow>
    <div v-if="leftover.length" class="py-4" data-testid="leftover-data">
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
            <Badge variant="outline" :class="cn('text-muted-foreground py-0 font-normal', entry.publisher && 'font-mono')" :title="entry.publisher ? t('settings.modules.publisherHint', { key: entry.publisher }) : undefined">
              {{ entry.publisher ? t("settings.modules.publisher", { short: entry.publisher.slice(0, 8) }) : t(`settings.modules.leftoverOwner.${entry.owner as "local" | "official"}`) }}
            </Badge>
          </span>
          <Button variant="danger" :aria-label="t('settings.modules.deleteDataLabel', { id: entry.moduleId })" :data-testid="`delete-data-${entry.owner}-${entry.moduleId}`" @click="deleteData(entry)">
            <Trash2 :stroke-width="1.5" /> {{ t("settings.modules.deleteData") }}
          </Button>
        </li>
      </ul>
    </div>
  </SettingGroup>
</template>
