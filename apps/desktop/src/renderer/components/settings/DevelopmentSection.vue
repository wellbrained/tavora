<script setup lang="ts">
// Settings > Development: for module developers. A development folder is a
// module's project folder, or the folder a developer keeps several projects
// in; Tavora loads every project in it and reloads its panels when the build
// changes. Each folder lists its modules, with Publish and Save as zip, or
// says what to do next for a project that loaded nothing. Below are the
// examples that ship with Tavora, to open or copy as a new project, then what
// a module developer has with the account, and the way to the docs and to
// GitHub. Once we know publishing isn't set up, a card offers the developer onboarding.
import { BookOpen, Bug, CircleAlert, Copy, FileArchive, FolderCode, FolderOpen, MessageCircleQuestion, Rocket, Trash2, Upload } from "@lucide/vue";
import { computed, onMounted } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { cn } from "@/lib/utils";
import type { DevelopmentProblemKind } from "../../../shared/host-api";
import { account, act, confirmAction, developerKeys, developerState, dialog, publishModule, saveModuleZip, showToast, state, submitAction } from "../../host";
import { t } from "../../i18n";
import ModuleDeveloperSettings from "../developer/ModuleDeveloperSettings.vue";
import ModuleRow from "./ModuleRow.vue";
import ProjectRow from "./ProjectRow.vue";
import RecoveryKeySettings from "./RecoveryKeySettings.vue";
import SettingGroup from "./SettingGroup.vue";
import SettingRow from "./SettingRow.vue";

defineProps<{ highlight: string | null }>();

/** Publishing needs the account; in builds without accounts there is none of it. */
const accounts = computed(() => account.value?.enabled === true);
/** The account's recovery key is on screen (made with a key here) or needed on this PC. */
const recoveryKey = computed(() => Boolean(developerKeys.value?.recoveryKey) || developerKeys.value?.status === "ask");

const modules = computed(() => state.value!.modules);
const folders = computed(() => state.value!.developmentFolders);
const examples = computed(() => modules.value.filter((module) => module.origin.kind === "example").sort((a, b) => a.name.localeCompare(b.name)));
const moduleById = (id: string) => modules.value.find((module) => module.id === id);

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
function advice(kind: DevelopmentProblemKind | null, message: string | null, folder: string): string {
  if (kind === "not-built") return t("settings.devFolders.notBuilt", { folder: baseName(folder) });
  if (kind === "no-module") return t("settings.devFolders.noModule");
  if (kind === "missing") return t("settings.devFolders.missing");
  return t("settings.devFolders.problem", { message: message ?? "" });
}
</script>

<template>
  <SettingGroup v-if="accounts && developerState === 'missing'">
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
      <li v-for="entry in folders" :key="entry.folder" class="flex flex-col gap-2 border-b pb-3 last:border-b-0" data-testid="development-folder">
        <div
          :class="cn('-mx-5 flex items-center gap-3 px-5 py-2.5', folderKind(entry) && folderTint[folderKind(entry)!])"
          :data-kind="folderKind(entry) ?? undefined"
          data-testid="development-folder-head"
        >
          <FolderCode class="text-muted-foreground size-4 flex-none" :stroke-width="1.5" />
          <span class="min-w-0 flex-1 truncate font-mono text-sm" :title="entry.folder" data-testid="development-folder-path">{{ shortPath(entry.folder) }}</span>
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
        <p v-if="entry.problem" class="text-muted-foreground flex gap-2 pl-7 text-sm" data-testid="development-folder-status">
          <CircleAlert class="text-warning mt-0.5 size-4 flex-none" :stroke-width="1.5" /> {{ advice(entry.kind, entry.problem, entry.folder) }}
        </p>
        <p v-else-if="!entry.projects.length" class="text-muted-foreground pl-7 text-sm" data-testid="development-folder-status">{{ t("settings.devFolders.empty") }}</p>
        <ul v-else class="flex flex-col pl-7">
          <template v-for="project in entry.projects" :key="project.project">
            <ModuleRow v-if="project.moduleId && moduleById(project.moduleId)" :module="moduleById(project.moduleId)!" hide-origin>
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
                <Button v-else variant="secondary" :data-testid="`publish-${project.moduleId}`" @click="publishModule(project.moduleId)">
                  <Upload :stroke-width="1.5" /> {{ t("publish.button") }}
                </Button>
              </template>
            </ModuleRow>
            <ProjectRow v-else :name="project.name ?? baseName(project.project)" :version="project.version" :status="advice(project.kind, project.problem, project.project)">
              <Button variant="ghost" size="icon" :aria-label="t('common.openFolder')" :title="t('common.openFolder')" data-testid="open-project" @click="openProject(project.project)">
                <FolderOpen :stroke-width="1.5" />
              </Button>
            </ProjectRow>
          </template>
        </ul>
      </li>
    </ul>
  </SettingGroup>

  <SettingGroup v-if="examples.length" :title="t('settings.development-examples.label')" :description="t('settings.development-examples.description')">
    <div
      :class="cn('-mx-5 px-5 transition-colors duration-500', highlight === 'development-examples' && 'bg-primary/10')"
      data-setting="development-examples"
    >
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

  <template v-if="accounts && account?.account">
    <RecoveryKeySettings v-if="recoveryKey" />
    <ModuleDeveloperSettings :highlight="highlight" />
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
