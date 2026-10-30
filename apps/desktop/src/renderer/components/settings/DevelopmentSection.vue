<script setup lang="ts">
// Settings > Development: for module developers. A development folder is a
// module's project folder, or the folder a developer keeps several projects
// in; Tavora loads every project in it and reloads its panels when the build
// changes. Each folder lists its modules, with Publish and Save as zip, or
// says what to do next for a project that loaded nothing; the developer closes
// folders and drags them into their own order. Below are the
// examples that ship with Tavora, to open or copy as a new project (folded away
// once the developer has modules of their own), then what a module developer has
// with the account, and the way to the docs and to GitHub. Once we know publishing
// isn't set up, a card offers the developer onboarding; on a new PC of a developer,
// getting the recovery key here comes first instead.
import { BookOpen, Bug, CircleAlert, Copy, FileArchive, FolderCode, FolderOpen, GripVertical, MessageCircleQuestion, Rocket, Trash2, Upload } from "@lucide/vue";
import { computed, onMounted, ref } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@tavora/official-ui/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { DevelopmentProblemKind } from "../../../shared/host-api";
import { problemText, type ModuleProblemValues } from "../../../shared/module-problem";
import { account, act, confirmAction, developerKeys, developerState, dialog, publishModule, releaseStatus, saveModuleZip, showToast, state, submitAction } from "../../host";
import { t } from "../../i18n";
import ModuleDeveloperSettings from "../developer/ModuleDeveloperSettings.vue";
import ModuleRow from "./ModuleRow.vue";
import ProjectRow from "./ProjectRow.vue";
import RecoveryKeySettings from "./RecoveryKeySettings.vue";
import SettingGroup from "./SettingGroup.vue";
import SettingRow from "./SettingRow.vue";

const props = defineProps<{ highlight: string | null }>();

// Players never see the developer tools until they ask for them: a card asks "Want to make modules?" and
// Let's go shows them, kept in the library (so in backups and the cloud copy). Anyone who already has
// project folders or a developer account, or who searched for one of these settings, gets them straight away.
function startMaking() {
  void act({ type: "set-makes-modules", on: true });
}

// Before it was a library setting, Let's go was kept in this window's local storage: carried over once.
const OLD_MAKES_MODULES = "tavora.makesModules";
const carriedOver = ref(false);
try {
  if (localStorage.getItem(OLD_MAKES_MODULES) === "1") {
    carriedOver.value = true;
    void act({ type: "set-makes-modules", on: true }, { quiet: true }).then((result) => {
      if (result.ok) localStorage.removeItem(OLD_MAKES_MODULES);
    });
  }
} catch {
  // No local storage: nothing to carry over.
}

/** Publishing needs the account; in builds without accounts there is none of it. */
const accounts = computed(() => account.value?.enabled === true);
/** The account's recovery key is on screen (made with a key here) or needed on this PC. */
const recoveryKey = computed(() => Boolean(developerKeys.value?.recoveryKey) || developerKeys.value?.status === "ask");
/** A developer on a new PC needs only the recovery key here, so the card asking "Want to make modules?" stays away. */
const startCard = computed(() => accounts.value && developerState.value === "missing" && !(account.value?.developer && recoveryKey.value));

const modules = computed(() => state.value!.modules);
const folders = computed(() => state.value!.developmentFolders);
const makesModules = computed(
  () =>
    state.value!.library.makesModules ||
    carriedOver.value ||
    folders.value.length > 0 ||
    Boolean(account.value?.developer) ||
    (props.highlight !== null && props.highlight !== "developer-docs"),
);
/** Built-in modules that can update from the catalogue; a dev build with that switched on can publish them. */
const builtIn = computed(() => modules.value.filter((module) => module.provenance === "official" && module.updatable).sort((a, b) => a.name.localeCompare(b.name)));
const examples = computed(() => modules.value.filter((module) => module.origin.kind === "example").sort((a, b) => a.name.localeCompare(b.name)));
const moduleById = (id: string) => modules.value.find((module) => module.id === id);
/** With modules of their own loaded when the page opens, the examples are folded away; a search for them opens them. */
const examplesOpen = ref(props.highlight === "development-examples" || !folders.value.some((entry) => entry.projects.some((project) => project.moduleId)));

type Module = (typeof modules.value)[number];
/** A development folder holding a module with a publishable id (not local.…) is a release copy, as ModuleRow tags it. */
const isRelease = (module: Module) => module.origin.kind === "dev" && !module.id.startsWith("local.");
/** The names after the prefix of the release copies loaded now: "enshrouded" for wellbrained.enshrouded. */
const releaseNames = computed(() => new Set(modules.value.filter(isRelease).map((module) => module.id.slice(module.id.indexOf(".") + 1))));
/** A local.… module whose release copy is loaded too: that copy is the one to publish, so this one has no Publish. */
const hasReleaseCopy = (module: Module) => module.id.startsWith("local.") && releaseNames.value.has(module.id.slice("local.".length));
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

async function publishOfficial(moduleId: string) {
  const result = await act({ type: "publish-official-module", moduleId });
  if (result.ok && result.id) showToast(t("officialPublish.done", { name: result.id }));
}

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

onMounted(() => {
  // The developer side as the service has it now, so the card goes once publishing is set up; quietly, offline is fine.
  if (account.value?.account) void act({ type: "account-refresh" }, { quiet: true });
});

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
  <SettingGroup v-if="!makesModules">
    <div class="flex flex-wrap items-center gap-x-6 gap-y-3 py-4" data-testid="development-intro">
      <Rocket class="text-primary size-6 flex-none" :stroke-width="1.5" aria-hidden="true" />
      <div class="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
        <span class="font-medium">{{ t("devStart.card.title") }}</span>
        <span class="text-muted-foreground text-sm">{{ t("settings.development-intro") }}</span>
      </div>
      <Button class="flex-none" data-testid="development-start" @click="startMaking">{{ t("devStart.card.start") }}</Button>
    </div>
  </SettingGroup>

  <template v-else>
  <RecoveryKeySettings v-if="accounts && account?.account && recoveryKey" />

  <SettingGroup v-if="startCard">
    <div class="flex flex-wrap items-center gap-x-6 gap-y-3 py-4" data-testid="developer-start-card">
      <Rocket class="text-primary size-6 flex-none" :stroke-width="1.5" aria-hidden="true" />
      <div class="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
        <span class="font-medium">{{ t("devStart.card.title") }}</span>
        <span class="text-muted-foreground text-sm">{{ t("devStart.card.text") }}</span>
      </div>
      <Button class="flex-none" data-testid="developer-start-open" @click="dialog = { kind: 'developer-start' }">{{ t("devStart.card.start") }}</Button>
    </div>
  </SettingGroup>

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
                <template v-if="accounts">
                  <Button
                    variant="ghost"
                    size="icon"
                    :aria-label="t('publish.saveZip')"
                    :title="t('publish.saveZip')"
                    :data-testid="`save-zip-${project.moduleId}`"
                    @click="saveModuleZip(project.moduleId)"
                  >
                    <FileArchive :stroke-width="1.5" />
                  </Button>
                  <span v-if="hasReleaseCopy(moduleById(project.moduleId)!)" class="text-muted-foreground text-xs" :data-testid="`publish-from-release-${project.moduleId}`">{{
                    t("publish.fromRelease")
                  }}</span>
                  <Button
                    v-else
                    variant="secondary"
                    :disabled="releaseStatus?.[project.moduleId] === 'in-review'"
                    :title="releaseStatus?.[project.moduleId] === 'in-review' ? t('release.inReviewHint') : undefined"
                    :data-testid="`publish-${project.moduleId}`"
                    @click="publishModule(project.moduleId)"
                  >
                    <Upload :stroke-width="1.5" /> {{ t("publish.button") }}
                  </Button>
                </template>
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

  <SettingGroup v-if="examples.length">
    <SettingRow
      :label="t('settings.development-examples.label')"
      :description="t('settings.development-examples.description')"
      setting="development-examples"
      :highlighted="highlight === 'development-examples'"
    >
      <Button variant="ghost" :aria-expanded="examplesOpen" data-testid="development-examples-toggle" @click="examplesOpen = !examplesOpen">
        {{ examplesOpen ? t("developer.ciHide") : t("developer.ciShow") }}
      </Button>
    </SettingRow>
    <div v-if="examplesOpen">
      <ul class="flex flex-col" :aria-label="t('settings.development-examples.label')" data-testid="development-examples">
        <ModuleRow v-for="module in examples" :key="module.id" :module="module" hide-origin>
          <Button variant="ghost" :data-testid="`open-example-${module.id}`" @click="act({ type: 'open-example-folder', moduleId: module.id })">
            <FolderOpen :stroke-width="1.5" /> {{ t("common.openFolder") }}
          </Button>
          <Button variant="secondary" :data-testid="`copy-example-${module.id}`" @click="dialog = { kind: 'copy-example', moduleId: module.id }">
            <Copy :stroke-width="1.5" /> {{ t("examples.copy") }}
          </Button>
        </ModuleRow>
      </ul>
    </div>
  </SettingGroup>

  <SettingGroup v-if="state!.officialPublish.available && builtIn.length" :title="t('officialPublish.title')" :description="t('officialPublish.description')">
    <ul class="flex flex-col" :aria-label="t('officialPublish.title')" data-testid="official-publish">
      <ModuleRow v-for="module in builtIn" :key="module.id" :module="module" hide-origin>
        <Button
          variant="secondary"
          :disabled="state!.officialPublish.busy !== null"
          :data-testid="`publish-official-${module.id}`"
          @click="publishOfficial(module.id)"
        >
          <Upload :stroke-width="1.5" /> {{ state!.officialPublish.busy === module.id ? t("officialPublish.working") : t("officialPublish.button") }}
        </Button>
      </ModuleRow>
    </ul>
  </SettingGroup>

  <template v-if="accounts && account?.account">
    <ModuleDeveloperSettings :highlight="highlight" />
  </template>
  </template>

  <SettingGroup :title="t('settings.heading.help')">
    <SettingRow
      :label="t('settings.developer-docs.label')"
      :description="t('settings.developer-docs.description')"
      setting="developer-docs"
      :highlighted="highlight === 'developer-docs'"
    >
      <span class="flex flex-none flex-wrap justify-end gap-2">
        <Button variant="secondary" data-testid="developer-link-docs" @click="act({ type: 'open-developer-link', link: 'docs' })">
          <BookOpen :stroke-width="1.5" /> {{ t("settings.devLinks.docs") }}
        </Button>
        <Button variant="secondary" data-testid="developer-link-discussions" @click="act({ type: 'open-developer-link', link: 'discussions' })">
          <MessageCircleQuestion :stroke-width="1.5" /> {{ t("settings.devLinks.discussions") }}
        </Button>
        <Button variant="secondary" data-testid="developer-link-issue" @click="act({ type: 'open-developer-link', link: 'issue' })">
          <Bug :stroke-width="1.5" /> {{ t("settings.devLinks.issue") }}
        </Button>
      </span>
    </SettingRow>
  </SettingGroup>
</template>
