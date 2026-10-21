<script setup lang="ts">
// Settings > Development: for module developers. A development folder is a
// module's project folder, or the folder a developer keeps several projects
// in; Tavora loads every project in it and reloads its panels when the build
// changes. Each project says what it loads or what to do next. Below are the
// modules loaded for development (the folders' and the examples that ship
// with Tavora), each from a project with Publish and Save as zip, then what
// a module developer has with the account, and the way to the docs and to
// GitHub. Until publishing is set up, a card offers the developer onboarding.
import { BookOpen, Bug, CircleAlert, CircleCheck, FileArchive, FolderCode, MessageCircleQuestion, Rocket, Trash2, Upload } from "@lucide/vue";
import { computed } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { cn } from "@/lib/utils";
import type { DevelopmentProblemKind } from "../../../shared/host-api";
import { account, act, developerKeys, developerReady, dialog, publishModule, saveModuleZip, showToast, state } from "../../host";
import { t } from "../../i18n";
import ModuleDeveloperSettings from "../developer/ModuleDeveloperSettings.vue";
import ModuleRow from "./ModuleRow.vue";
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
const developmentModules = computed(() => modules.value.filter((module) => module.development).sort((a, b) => a.name.localeCompare(b.name)));

async function addFolder() {
  const result = await act({ type: "add-development-folder" });
  if (result.ok && result.id) showToast(t("settings.devFolders.added", { folder: result.id }));
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

/** What to do about a folder or project that loaded nothing, in words. */
function advice(kind: DevelopmentProblemKind | null, message: string | null, folder: string): string {
  if (kind === "not-built") return t("settings.devFolders.notBuilt", { folder: baseName(folder) });
  if (kind === "no-module") return t("settings.devFolders.noModule");
  if (kind === "missing") return t("settings.devFolders.missing");
  return t("settings.devFolders.problem", { message: message ?? "" });
}

function loads(moduleId: string): string {
  const module = modules.value.find((item) => item.id === moduleId);
  return module ? t("settings.devFolders.loads", { name: module.name, version: module.version }) : "";
}
</script>

<template>
  <SettingGroup v-if="accounts && !developerReady">
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
      <li v-for="entry in folders" :key="entry.folder" class="flex flex-col gap-2 border-b py-3 last:border-b-0" data-testid="development-folder">
        <div class="flex items-center gap-3">
          <FolderCode class="text-muted-foreground size-4 flex-none" :stroke-width="1.5" />
          <span class="min-w-0 flex-1 truncate font-mono text-sm" :title="entry.folder" data-testid="development-folder-path">{{ shortPath(entry.folder) }}</span>
          <Button
            variant="danger"
            class="flex-none"
            :aria-label="t('settings.devFolders.removeLabel', { folder: entry.folder })"
            data-testid="remove-development-folder"
            @click="act({ type: 'remove-development-folder', folder: entry.folder })"
          >
            <Trash2 :stroke-width="1.5" /> {{ t("settings.devFolders.remove") }}
          </Button>
        </div>
        <p v-if="entry.problem" class="text-muted-foreground flex gap-2 pl-7 text-sm" data-testid="development-folder-status">
          <CircleAlert class="text-warning mt-0.5 size-4 flex-none" :stroke-width="1.5" /> {{ advice(entry.kind, entry.problem, entry.folder) }}
        </p>
        <p v-else-if="!entry.projects.length" class="text-muted-foreground pl-7 text-sm" data-testid="development-folder-status">{{ t("settings.devFolders.empty") }}</p>
        <ul v-else class="flex flex-col gap-2 pl-7">
          <li v-for="project in entry.projects" :key="project.project" class="flex gap-2 text-sm" data-testid="development-project">
            <CircleCheck v-if="project.moduleId" class="text-success mt-0.5 size-4 flex-none" :stroke-width="1.5" />
            <CircleAlert v-else class="text-warning mt-0.5 size-4 flex-none" :stroke-width="1.5" />
            <span class="flex min-w-0 flex-col">
              <span v-if="project.project !== entry.folder" class="truncate font-mono text-xs" :title="project.project">{{ baseName(project.project) }}</span>
              <span :class="cn('text-muted-foreground', !project.moduleId && 'text-foreground')" data-testid="development-project-status">{{
                project.moduleId ? loads(project.moduleId) : advice(project.kind, project.problem, project.project)
              }}</span>
            </span>
          </li>
        </ul>
      </li>
    </ul>
  </SettingGroup>

  <SettingGroup :title="t('settings.development-modules.label')" :description="t('settings.development-modules.description')">
    <div
      :class="cn('-mx-5 px-5 transition-colors duration-500', highlight === 'development-modules' && 'bg-primary/10')"
      data-setting="development-modules"
    >
      <ul class="flex flex-col" :aria-label="t('settings.development-modules.label')" data-testid="development-module-list">
        <ModuleRow v-for="module in developmentModules" :key="module.id" :module="module">
          <template v-if="module.project && accounts">
            <Button variant="ghost" :aria-label="t('publish.saveZip')" :title="t('publish.saveZip')" :data-testid="`save-zip-${module.id}`" @click="saveModuleZip(module.id)">
              <FileArchive :stroke-width="1.5" /> {{ t("publish.saveZip") }}
            </Button>
            <Button variant="secondary" :data-testid="`publish-${module.id}`" @click="publishModule(module.id)">
              <Upload :stroke-width="1.5" /> {{ t("publish.button") }}
            </Button>
          </template>
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
