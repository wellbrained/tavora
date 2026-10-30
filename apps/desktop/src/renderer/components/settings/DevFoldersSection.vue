<script setup lang="ts">
// Settings > Project folders: where Tavora loads a developer's modules from. A folder is a module's project folder,
// or the folder a developer keeps several projects in; Tavora loads every project in it and reloads its panels when
// the build changes. Each folder lists what it loaded, or says what to do next for a project that loaded nothing;
// the developer closes folders and drags them into their own order. Publishing is on Your modules.
import { CircleAlert, FolderCode, FolderOpen, GripVertical, Trash2 } from "@lucide/vue";
import { computed, ref } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@tavora/official-ui/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { DevelopmentProblemKind } from "../../../shared/host-api";
import { problemText, type ModuleProblemValues } from "../../../shared/module-problem";
import { act, confirmAction, showToast, state, submitAction } from "../../host";
import { t } from "../../i18n";
import { isReleaseCopy as isRelease } from "../developer/dev-modules";
import ModuleRow from "./ModuleRow.vue";
import ProjectRow from "./ProjectRow.vue";
import SettingGroup from "./SettingGroup.vue";
import SettingRow from "./SettingRow.vue";

defineProps<{ highlight: string | null }>();

const modules = computed(() => state.value!.modules);
const folders = computed(() => state.value!.developmentFolders);
const moduleById = (id: string) => modules.value.find((module) => module.id === id);
/**
 * What a folder holds, for its row's tint: only local modules (blue, like their badge), only release copies (green),
 * or something else (mixed, none loaded yet): no tint.
 */
function folderKind(entry: (typeof folders.value)[number]): "local" | "release" | null {
  const loaded = entry.projects.map((project) => (project.moduleId ? moduleById(project.moduleId) : undefined)).filter((module) => module !== undefined);
  if (!loaded.length) return null;
  if (loaded.every(isRelease)) return "release";
  if (loaded.every((module) => !isRelease(module))) return "local";
  return null;
}
const folderTint = { local: "bg-info/15 shadow-[inset_3px_0_0_var(--info)]", release: "bg-success/15 shadow-[inset_3px_0_0_var(--success)]" } as const;

async function addFolder() {
  const result = await act({ type: "add-development-folder" });
  if (result.ok && result.id) showToast(t("settings.devFolders.added", { folder: result.id }));
}

function removeFolder(folder: string) {
  confirmAction({
    title: t("settings.devFolders.removeTitle"),
    message: t("settings.devFolders.removeMessage"),
    confirm: t("settings.devFolders.remove"),
    danger: true,
    run: () => submitAction({ type: "remove-development-folder", folder }),
  });
}

// The user puts the folders in their own order: drag one by its grip, or press the arrow keys on it.
const dragging = ref<string | null>(null);
/** Where the dragged folder would land: above or below `folder`. */
const dropAt = ref<{ folder: string; after: boolean } | null>(null);

function moveTo(folder: string, index: number) {
  if (index < 0 || index >= folders.value.length) return;
  void act({ type: "move-development-folder", folder, index });
}

function onDragStart(event: DragEvent, folder: string) {
  if (!event.dataTransfer) return;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", folder);
  const head = (event.target as HTMLElement).closest('[data-testid="development-folder-head"]');
  if (head) event.dataTransfer.setDragImage(head, 24, 20);
  dragging.value = folder;
}

function onDragOver(event: DragEvent, folder: string) {
  if (!dragging.value) return;
  event.preventDefault();
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
  dropAt.value = { folder, after: event.clientY > box.top + box.height / 2 };
}

function onDrop(event: DragEvent, index: number) {
  const folder = dragging.value;
  const target = dropAt.value;
  onDragEnd();
  if (!folder || !target) return;
  event.preventDefault();
  const from = folders.value.findIndex((entry) => entry.folder === folder);
  // The index once the dragged folder is out of the list.
  const to = index + (target.after ? 1 : 0) - (from < index ? 1 : 0);
  if (to !== from) moveTo(folder, to);
}

function onDragEnd() {
  dragging.value = null;
  dropAt.value = null;
}

const parts = (folder: string) => folder.split(/[\\/]/).filter(Boolean);
const baseName = (folder: string) => parts(folder).at(-1) ?? folder;

/** A long path shortened at its start, so the end, which tells folders apart, stays readable. */
function shortPath(folder: string): string {
  const all = parts(folder);
  if (all.length <= 3) return folder;
  const sep = folder.includes("\\") ? "\\" : "/";
  return `…${sep}${all.slice(-2).join(sep)}`;
}

const openProject = (project: string) => act({ type: "open-development-project", project });

/** What to do about a folder or project that loaded nothing, in words. */
function advice(kind: DevelopmentProblemKind | null, values: ModuleProblemValues | undefined, folder: string): string {
  return problemText(t, "development", kind, values, baseName(folder));
}
</script>

<template>
  <SettingGroup>
    <SettingRow
      :label="t('settings.development-folders.label')"
      :description="t('settings.development-folders.description')"
      setting="development-folders"
      :highlighted="highlight === 'development-folders'"
    >
      <Button variant="secondary" class="flex-none" data-testid="add-development-folder" @click="addFolder">
        <FolderCode :stroke-width="1.5" /> {{ t("settings.devFolders.add") }}
      </Button>
    </SettingRow>
    <ul v-if="folders.length" class="flex flex-col" :aria-label="t('settings.development-folders.label')" data-testid="development-folders">
      <Collapsible
        v-for="(entry, index) in folders"
        :key="entry.folder"
        as="li"
        :open="!entry.collapsed"
        :class="cn('relative flex flex-col gap-2 border-b last:border-b-0', !entry.collapsed && 'pb-3', dragging === entry.folder && 'opacity-50')"
        data-testid="development-folder"
        :data-collapsed="entry.collapsed || undefined"
        @update:open="(open: boolean) => act({ type: 'collapse-development-folder', folder: entry.folder, collapsed: !open })"
        @dragover="onDragOver($event, entry.folder)"
        @drop="onDrop($event, index)"
      >
        <span v-if="dropAt?.folder === entry.folder" :class="cn('bg-primary absolute inset-x-0 z-10 h-0.5', dropAt.after ? '-bottom-px' : '-top-px')" aria-hidden="true" />
        <div
          :class="cn('-mx-5 flex items-center gap-2 py-2.5 pr-5 pl-2', folderKind(entry) && folderTint[folderKind(entry)!])"
          :data-kind="folderKind(entry) ?? undefined"
          data-testid="development-folder-head"
        >
          <Button
            v-if="folders.length > 1"
            variant="ghost"
            size="icon"
            class="text-muted-foreground flex-none cursor-grab active:cursor-grabbing"
            draggable="true"
            :aria-label="t('settings.devFolders.move', { folder: entry.folder })"
            :title="t('settings.devFolders.move', { folder: shortPath(entry.folder) })"
            data-testid="move-development-folder"
            @dragstart="onDragStart($event, entry.folder)"
            @dragend="onDragEnd"
            @keydown.up.prevent="moveTo(entry.folder, index - 1)"
            @keydown.down.prevent="moveTo(entry.folder, index + 1)"
          >
            <GripVertical :stroke-width="1.5" />
          </Button>
          <CollapsibleTrigger :class="cn('min-w-0 flex-1 gap-3 py-1 font-normal', folders.length <= 1 && 'pl-3')" data-testid="development-folder-toggle">
            <FolderCode class="text-muted-foreground size-4 flex-none" :stroke-width="1.5" />
            <span class="min-w-0 truncate font-mono text-sm" :title="entry.folder" data-testid="development-folder-path">{{ shortPath(entry.folder) }}</span>
            <span v-if="entry.collapsed && entry.projects.length" class="text-muted-foreground flex-none text-xs" data-testid="development-folder-count">{{
              t("settings.devFolders.count", { count: entry.projects.length })
            }}</span>
            <CircleAlert
              v-if="entry.collapsed && entry.problem"
              class="text-warning size-4 flex-none"
              :stroke-width="1.5"
              :aria-label="advice(entry.kind, entry.values, entry.folder)"
              :title="advice(entry.kind, entry.values, entry.folder)"
            />
          </CollapsibleTrigger>
          <Button
            variant="danger"
            class="flex-none"
            :aria-label="t('settings.devFolders.removeLabel', { folder: entry.folder })"
            data-testid="remove-development-folder"
            @click="removeFolder(entry.folder)"
          >
            <Trash2 :stroke-width="1.5" /> {{ t("settings.devFolders.remove") }}
          </Button>
        </div>
        <CollapsibleContent class="flex flex-col gap-2">
          <p v-if="entry.problem" class="text-muted-foreground flex gap-2 pl-7 text-sm" data-testid="development-folder-status">
            <CircleAlert class="text-warning mt-0.5 size-4 flex-none" :stroke-width="1.5" /> {{ advice(entry.kind, entry.values, entry.folder) }}
          </p>
          <p v-else-if="!entry.projects.length" class="text-muted-foreground pl-7 text-sm" data-testid="development-folder-status">{{ t("settings.devFolders.empty") }}</p>
          <ul v-else class="flex flex-col pl-7">
            <template v-for="project in entry.projects" :key="project.project">
              <ModuleRow v-if="project.moduleId && moduleById(project.moduleId)" :module="moduleById(project.moduleId)!" hide-origin compact>
                <Button
                  variant="ghost"
                  size="icon"
                  :aria-label="t('common.openFolder')"
                  :title="t('common.openFolder')"
                  :data-testid="`open-project-${project.moduleId}`"
                  @click="openProject(project.project)"
                >
                  <FolderOpen :stroke-width="1.5" />
                </Button>
              </ModuleRow>
              <ProjectRow v-else :name="project.name ?? baseName(project.project)" :version="project.version" :status="advice(project.kind, project.values, project.project)">
                <Button variant="ghost" size="icon" :aria-label="t('common.openFolder')" :title="t('common.openFolder')" data-testid="open-project" @click="openProject(project.project)">
                  <FolderOpen :stroke-width="1.5" />
                </Button>
              </ProjectRow>
            </template>
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </ul>
  </SettingGroup>

</template>
