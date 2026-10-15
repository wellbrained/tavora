<script setup lang="ts">
import { RotateCw, Search, X } from "@lucide/vue";
import { computed, nextTick, ref, watch } from "vue";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { LANGUAGES } from "../../../shared/i18n";
import { rank } from "@/lib/search";
import { cn } from "@/lib/utils";
import type { RootSort, Startup } from "../../../shared/host-api";
import type { LanguageSetting } from "../../../shared/i18n";
import { PATCH_NOTES } from "../../../shared/patch-notes";
import { act, confirmAction, dialog, settingsOpen, settingsTarget, state, submitAction } from "../../host";
import { formatDate, language, t } from "../../i18n";
import { MOD, shortcutGroups } from "../../shortcuts";
import GameIcon from "../GameIcon.vue";
import AppearanceSection from "./AppearanceSection.vue";
import ModulesSection from "./ModulesSection.vue";
import BrowserSection from "./BrowserSection.vue";
import DiscordSection from "./DiscordSection.vue";
import SegmentedControl from "./SegmentedControl.vue";
import { GROUPS, groupLabel, sectionLabel, settingEntries, type SettingsSection } from "./settings-index";
import SettingRow from "./SettingRow.vue";

const section = ref<SettingsSection>("general");
const query = ref("");
/** The setting a search result led to, tinted for a moment. */
const highlight = ref<string | null>(null);
let highlightTimer: ReturnType<typeof setTimeout> | undefined;

// Settings opens where it was asked to: its first section, or a setting
// found with Ctrl+K.
watch(settingsOpen, (open) => {
  if (!open) return;
  query.value = "";
  void show(settingsTarget.value.section, settingsTarget.value.setting);
});
// Asked again while open (e.g. Ctrl+/ over Settings): go there.
watch(settingsTarget, (target) => {
  if (settingsOpen.value) void show(target.section, target.setting);
});

async function show(target: SettingsSection, setting?: string) {
  section.value = target;
  query.value = "";
  clearTimeout(highlightTimer);
  highlight.value = setting ?? null;
  if (!setting) return;
  await nextTick();
  document.querySelector(`[data-setting="${CSS.escape(setting)}"]`)?.scrollIntoView({ block: "center" });
  highlightTimer = setTimeout(() => (highlight.value = null), 2000);
}

const library = computed(() => state.value!.library);
const formatDateTime = (iso: string) => formatDate(iso, { dateStyle: "medium", timeStyle: "short" });
const version = computed(() => state.value!.appVersion);

interface Result {
  id: string;
  section: SettingsSection;
  label: string;
  description: string;
  keywords: string[];
}

// Settings, plus the games in Trash, so "valheim" finds a removed game.
const results = computed<Result[]>(() => {
  if (!query.value.trim()) return [];
  const trashed = library.value.trash.map((entry) => ({
    id: `trash-${entry.game.id}`,
    section: "trash" as const,
    label: entry.game.name,
    description: t("settings.results.trashUntil", { date: formatDate(entry.purgeAt) }),
    keywords: [],
  }));
  return rank([...settingEntries(), ...trashed], query.value, (item) => ({
    name: item.label,
    extra: [item.description, sectionLabel(item.section), ...item.keywords],
  }));
});

function onSearchKey(event: KeyboardEvent) {
  if (event.key === "Escape" && query.value) {
    // Clear the search first; a second Escape closes Settings.
    event.preventDefault();
    event.stopPropagation();
    query.value = "";
  } else if (event.key === "Enter" && results.value[0]) {
    void show(results.value[0].section, results.value[0].id);
  }
}

const startup = computed({
  get: () => library.value.startup,
  set: (value: Startup) => void act({ type: "set-startup", startup: value }),
});
const sort = computed({
  get: () => library.value.sort,
  set: (value: RootSort) => void act({ type: "set-sort", sort: value }),
});
const languageSetting = computed({
  get: () => state.value!.language.setting,
  set: (value: LanguageSetting) => void act({ type: "set-language", language: value }),
});
const grayscaleText = computed({
  get: () => library.value.grayscaleText,
  set: (enabled: boolean) => void act({ type: "set-grayscale-text", enabled }),
});
/** What the Updates row says, and what its button does. */
const updateRow = computed(() => {
  const u = state.value!.update;
  if (u.status === "checking") return { text: t("settings.updates.checking"), button: t("settings.updates.checkingButton"), busy: true, run: null };
  if (u.status === "downloading") return { text: t("settings.updates.downloading", { version: u.version }), button: t("settings.updates.downloadingButton"), busy: true, run: null };
  if (u.status === "ready") return { text: t("settings.updates.ready", { version: u.version }), button: t("common.restartNow"), busy: false, run: "restart-to-update" as const };
  if (u.status === "available") return { text: t("settings.updates.available", { version: u.version }), button: t("settings.updates.download"), busy: false, run: "download-update" as const };
  const text = u.failed
    ? t("settings.updates.failed")
    : u.checkedAt
      ? t("settings.updates.upToDate", { date: formatDateTime(u.checkedAt) })
      : t("settings.updates.idle");
  return { text, button: t("settings.updates.checkNow"), busy: false, run: "check-for-updates" as const };
});
const copied = ref(false);
async function copyDiagnostics() {
  const result = await act({ type: "copy-diagnostics" });
  if (!result.ok) return;
  copied.value = true;
  setTimeout(() => (copied.value = false), 2500);
}

function pressUpdateButton() {
  const run = updateRow.value.run;
  if (run) void act({ type: run });
}

const autoUpdate = computed({
  get: () => library.value.autoUpdate,
  set: (enabled: boolean) => void act({ type: "set-auto-update", enabled }),
});
const onlineSearch = computed({
  get: () => library.value.onlineSearch,
  set: (enabled: boolean) => void act({ type: "set-online-search", enabled }),
});
const steamIcons = computed({
  get: () => library.value.steamIcons,
  set: (enabled: boolean) => void act({ type: "set-steam-icons", enabled }),
});

/** Leaves Settings and Home shows the first-run welcome again. */
async function showWelcomeAgain() {
  const result = await act({ type: "set-onboarded", done: false });
  if (!result.ok) return;
  settingsOpen.value = false;
  await act({ type: "show-welcome" });
}

function deleteNow(gameId: string, name: string) {
  confirmAction({
    title: t("settings.trash.deleteTitle", { name }),
    message: t("settings.trash.deleteMessage"),
    confirm: t("settings.trash.deleteConfirm"),
    danger: true,
    run: () => submitAction({ type: "delete-game", gameId }),
  });
}
</script>

<template>
  <Dialog v-model:open="settingsOpen">
    <DialogContent
      class="bg-card flex h-[min(760px,calc(100vh-48px))] w-[min(1040px,calc(100vw-48px))] max-w-none gap-0 overflow-hidden p-0 sm:max-w-none"
      data-testid="settings"
      :show-close-button="false"
      :aria-describedby="undefined"
    >
      <nav class="bg-background flex w-60 flex-none flex-col gap-4 overflow-y-auto border-r p-3" :aria-label="t('settings.sections')">
        <DialogTitle class="px-3 pt-2 text-lg font-semibold">{{ t("settings.title") }}</DialogTitle>
        <div class="relative">
          <Search class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" :stroke-width="1.5" />
          <input
            v-model="query"
            type="text"
            class="bg-card placeholder:text-muted-foreground focus-visible:ring-ring h-9 w-full rounded-lg border pr-3 pl-9 text-sm focus-visible:ring-2 focus-visible:outline-none"
            :placeholder="t('settings.search')"
            :aria-label="t('settings.search')"
            autocomplete="off"
            maxlength="80"
            data-testid="settings-search"
            @keydown="onSearchKey"
          />
        </div>
        <div v-for="group in GROUPS" :key="group.id" class="flex flex-col gap-0.5">
          <h3 class="text-muted-foreground px-3 pb-1 text-xs font-medium">{{ groupLabel(group.id) }}</h3>
          <button
            v-for="item in group.sections"
            :key="item.id"
            type="button"
            :class="
              cn(
                'text-muted-foreground hover:bg-accent hover:text-foreground flex h-9 items-center gap-3 rounded-lg px-3 text-left font-medium',
                !query && section === item.id && 'bg-accent text-foreground',
              )
            "
            :data-testid="`settings-nav-${item.id}`"
            :aria-current="!query && section === item.id ? 'page' : undefined"
            @click="show(item.id)"
          >
            <component :is="item.icon" class="size-4 flex-none" :stroke-width="1.5" />
            <span class="flex-1">{{ sectionLabel(item.id) }}</span>
            <span v-if="item.id === 'trash' && library.trash.length" class="text-muted-foreground text-xs tabular-nums">{{ library.trash.length }}</span>
          </button>
        </div>
        <button
          type="button"
          :class="
            cn(
              'text-muted-foreground hover:bg-accent hover:text-foreground mt-auto rounded-lg px-3 py-2 text-left text-xs tabular-nums',
              !query && section === 'patch-notes' && 'bg-accent text-foreground',
            )
          "
          :title="t('settings.version')"
          data-testid="settings-version"
          @click="show('patch-notes')"
        >
          Tavora {{ version }}
        </button>
      </nav>

      <div class="relative flex min-w-0 flex-1 flex-col overflow-y-auto">
        <DialogClose as-child>
          <Button variant="ghost" size="icon" class="absolute top-4 right-4" data-testid="settings-close" :aria-label="t('settings.close')" :title="t('common.close')">
            <X :stroke-width="1.5" />
          </Button>
        </DialogClose>

        <div class="max-w-[760px] px-10 py-10">
          <template v-if="query.trim()">
            <h2 class="mb-4 text-xl font-semibold">{{ t("settings.results.title") }}</h2>
            <p v-if="!results.length" class="text-muted-foreground" data-testid="settings-no-results">{{ t("settings.results.none", { query: query.trim() }) }}</p>
            <ul v-else class="-mx-3 flex flex-col gap-1" :aria-label="t('settings.results.title')" data-testid="settings-results">
              <li v-for="result in results" :key="result.id">
                <button
                  type="button"
                  class="hover:bg-accent focus-visible:bg-accent flex w-full flex-col gap-1 rounded-lg px-3 py-3 text-left"
                  :data-testid="`settings-result-${result.id}`"
                  @click="show(result.section, result.id)"
                >
                  <span class="text-muted-foreground text-xs font-medium">{{ sectionLabel(result.section) }}</span>
                  <span class="font-medium">{{ result.label }}</span>
                  <span class="text-muted-foreground">{{ result.description }}</span>
                </button>
              </li>
            </ul>
          </template>

          <template v-else-if="section === 'general'">
            <h2 class="mb-4 text-xl font-semibold">{{ t("settings.section.general") }}</h2>
            <SettingRow
              :label="t('settings.startup.label')"
              :description="t('settings.startup.description')"
              setting="startup"
              :highlighted="highlight === 'startup'"
            >
              <SegmentedControl
                v-model="startup"
                :label="t('settings.startup.label')"
                :options="[
                  { value: 'welcome', label: t('settings.startup.home'), testid: 'startup-welcome' },
                  { value: 'last-game', label: t('settings.startup.lastGame'), testid: 'startup-last-game' },
                ]"
              />
            </SettingRow>
            <SettingRow
              :label="t('settings.sort.label')"
              :description="t('settings.sort.description')"
              setting="sort"
              :highlighted="highlight === 'sort'"
            >
              <SegmentedControl
                v-model="sort"
                :label="t('settings.sort.label')"
                :options="[
                  { value: 'recent', label: t('settings.sort.recent'), testid: 'sort-recent' },
                  { value: 'manual', label: t('settings.sort.manual'), testid: 'sort-manual' },
                ]"
              />
            </SettingRow>
            <SettingRow
              :label="t('settings.language.label')"
              :description="t('settings.language.description')"
              setting="language"
              :highlighted="highlight === 'language'"
            >
              <SegmentedControl
                v-model="languageSetting"
                :label="t('settings.language.label')"
                :options="[
                  { value: 'system', label: t('settings.language.system'), testid: 'language-system' },
                  ...LANGUAGES.map((item) => ({ value: item.id, label: item.name, testid: `language-${item.id}` })),
                ]"
              />
            </SettingRow>
            <SettingRow
              :label="t('settings.grayscale-text.label')"
              :description="t('settings.grayscale-text.description')"
              setting="grayscale-text"
              :highlighted="highlight === 'grayscale-text'"
            >
              <Switch v-model="grayscaleText" :aria-label="t('settings.grayscale-text.label')" data-testid="grayscale-text" />
            </SettingRow>
            <SettingRow
              :label="t('settings.online-search.label')"
              :description="t('settings.online-search.description')"
              setting="online-search"
              :highlighted="highlight === 'online-search'"
            >
              <Switch v-model="onlineSearch" :aria-label="t('settings.online-search.label')" data-testid="online-search" />
            </SettingRow>
            <SettingRow
              :label="t('settings.auto-update.label')"
              :description="t('settings.auto-update.description')"
              setting="auto-update"
              :highlighted="highlight === 'auto-update'"
            >
              <Switch v-model="autoUpdate" :aria-label="t('settings.auto-update.label')" data-testid="auto-update" />
            </SettingRow>
            <SettingRow
              :label="t('settings.check-updates.label')"
              :description="updateRow.text"
              setting="check-updates"
              :highlighted="highlight === 'check-updates'"
            >
              <Button variant="secondary" :disabled="updateRow.busy" data-testid="check-updates" @click="pressUpdateButton">{{ updateRow.button }}</Button>
            </SettingRow>
            <SettingRow
              :label="t('settings.backups.label')"
              :description="t('settings.backups.description')"
              setting="backups"
              :highlighted="highlight === 'backups'"
            >
              <Button variant="secondary" data-testid="open-backups" @click="submitAction({ type: 'open-backups' })">{{ t("common.openFolder") }}</Button>
            </SettingRow>
            <SettingRow
              :label="t('settings.diagnostics.label')"
              :description="t('settings.diagnostics.description')"
              setting="diagnostics"
              :highlighted="highlight === 'diagnostics'"
            >
              <Button variant="secondary" data-testid="copy-diagnostics" @click="copyDiagnostics">{{ copied ? t("settings.diagnostics.copied") : t("settings.diagnostics.copy") }}</Button>
            </SettingRow>
            <SettingRow
              :label="t('settings.steam-icons.label')"
              :description="t('settings.steam-icons.description')"
              setting="steam-icons"
              :highlighted="highlight === 'steam-icons'"
            >
              <Switch v-model="steamIcons" :aria-label="t('settings.steam-icons.label')" data-testid="steam-icons" />
            </SettingRow>
            <p class="text-muted-foreground -mt-2 mb-4 max-w-prose text-xs leading-relaxed" data-testid="icon-notice">
              {{ t("settings.iconNotice") }}
            </p>
            <SettingRow
              :label="t('settings.share-icons.label')"
              :description="t('settings.share-icons.description')"
              setting="share-icons"
              :highlighted="highlight === 'share-icons'"
            >
              <Button
                variant="secondary"
                data-testid="open-share-icons"
                :disabled="!library.onlineSearch || !library.steamIcons"
                @click="dialog = { kind: 'share-icons', gameIds: [] }"
              >
                {{ t("settings.shareIcons.button") }}
              </Button>
            </SettingRow>
            <SettingRow
              :label="t('settings.steam-import.label')"
              :description="t('settings.steam-import.description')"
              setting="steam-import"
              :highlighted="highlight === 'steam-import'"
            >
              <Button variant="secondary" data-testid="open-steam-import-settings" :disabled="!library.onlineSearch" @click="dialog = { kind: 'steam-import' }">
                {{ t("settings.steamImport.button") }}
              </Button>
            </SettingRow>
            <SettingRow
              :label="t('settings.welcome-tour.label')"
              :description="t('settings.welcome-tour.description')"
              setting="welcome-tour"
              :highlighted="highlight === 'welcome-tour'"
            >
              <Button variant="secondary" data-testid="show-welcome-again" @click="showWelcomeAgain">{{ t("settings.welcome.button") }}</Button>
            </SettingRow>
          </template>

          <template v-else-if="section === 'appearance'">
            <AppearanceSection :highlight="highlight" />
          </template>

          <template v-else-if="section === 'modules'">
            <ModulesSection :highlight="highlight" />
          </template>

          <template v-else-if="section === 'browser'">
            <BrowserSection :highlight="highlight" />
          </template>

          <template v-else-if="section === 'discord'">
            <DiscordSection :highlight="highlight" />
          </template>

          <template v-else-if="section === 'shortcuts'">
            <h2
              :class="cn('-mx-3 rounded-lg px-3 text-xl font-semibold transition-colors duration-500', highlight === 'shortcuts' && 'bg-primary/10')"
              data-setting="shortcuts"
            >
              {{ t("settings.section.shortcuts") }}
            </h2>
            <p class="text-muted-foreground mt-2 mb-6">{{ t("settings.shortcuts.intro", { mod: MOD() }) }}</p>
            <div class="flex flex-col gap-6" data-testid="shortcuts">
              <section v-for="group in shortcutGroups()" :key="group.title">
                <h3 class="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">{{ group.title }}</h3>
                <ul>
                  <li v-for="row in group.rows" :key="row.action" class="flex min-h-11 items-center gap-6 border-b py-2 last:border-b-0">
                    <span class="min-w-0 flex-1">{{ row.action }}</span>
                    <span class="flex flex-none items-center gap-1">
                      <kbd
                        v-for="key in row.keys"
                        :key="key"
                        class="bg-secondary text-foreground min-w-7 rounded-sm border border-b-2 px-1.5 py-0.5 text-center font-mono text-xs"
                        >{{ key }}</kbd
                      >
                    </span>
                  </li>
                </ul>
              </section>
            </div>
          </template>

          <template v-else-if="section === 'patch-notes'">
            <h2
              :class="cn('-mx-3 rounded-lg px-3 text-xl font-semibold transition-colors duration-500', highlight === 'patch-notes' && 'bg-primary/10')"
              data-setting="patch-notes"
            >
              {{ t("settings.section.patch-notes") }}
            </h2>
            <p class="text-muted-foreground mt-2 mb-6">{{ t("settings.patchNotes.intro") }}</p>
            <div class="flex flex-col gap-8" data-testid="patch-notes">
              <article v-for="entry in PATCH_NOTES" :key="entry.version" :data-testid="`patch-notes-${entry.version}`">
                <header class="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h3 class="text-lg font-semibold tabular-nums">{{ entry.version }}</h3>
                  <span v-if="entry.version === version" class="bg-secondary text-foreground rounded-sm px-1.5 py-0.5 text-xs">{{ t("settings.patchNotes.installed") }}</span>
                  <span class="text-muted-foreground text-sm">{{ formatDate(entry.date) }}</span>
                </header>
                <p class="mb-2 font-medium">{{ entry.title }}</p>
                <ul class="text-muted-foreground flex list-disc flex-col gap-1.5 pl-5">
                  <li v-for="note in entry.notes" :key="note">{{ note }}</li>
                </ul>
              </article>
            </div>
          </template>

          <template v-else-if="section === 'trash'">
            <h2 :class="cn('-mx-3 rounded-lg px-3 text-xl font-semibold transition-colors duration-500', highlight === 'trash' && 'bg-primary/10')" data-setting="trash">
              {{ t("settings.section.trash") }}
            </h2>
            <p class="text-muted-foreground mt-2 mb-4">{{ t("settings.trash.description") }}</p>
            <div class="border-t" data-testid="trash">
              <p v-if="!library.trash.length" class="text-muted-foreground py-4" data-testid="trash-empty">{{ t("settings.trash.empty") }}</p>
              <ul v-else>
                <li
                  v-for="entry in library.trash"
                  :key="entry.game.id"
                  :class="
                    cn(
                      '-mx-3 flex min-h-16 items-center gap-4 rounded-lg border-b px-3 py-3 transition-colors duration-500 last:border-b-0',
                      highlight === `trash-${entry.game.id}` && 'bg-primary/10',
                    )
                  "
                  :data-testid="`trash-${entry.game.id}`"
                  :data-setting="`trash-${entry.game.id}`"
                >
                  <GameIcon :game="entry.game" :size="40" />
                  <span class="flex min-w-0 flex-1 flex-col gap-1">
                    <span class="truncate font-medium">{{ entry.game.name }}</span>
                    <span class="text-muted-foreground">{{ t("settings.trash.deleteOn", { date: formatDate(entry.purgeAt) }) }}</span>
                  </span>
                  <Button variant="secondary" :data-testid="`restore-${entry.game.id}`" @click="act({ type: 'restore-game', gameId: entry.game.id })">
                    {{ t("settings.trash.restore") }}
                  </Button>
                  <Button variant="secondary" class="text-destructive" :data-testid="`delete-${entry.game.id}`" @click="deleteNow(entry.game.id, entry.game.name)">
                    {{ t("settings.trash.deleteNow") }}
                  </Button>
                </li>
              </ul>
            </div>
          </template>
        </div>

        <!-- Settings that apply on start share one bar, so several changes need one restart. -->
        <div
          v-if="state!.restartPending"
          class="bg-card sticky bottom-0 mt-auto flex flex-none items-center gap-4 border-t px-10 py-3"
          role="status"
          data-testid="restart-bar"
        >
          <RotateCw class="text-primary size-4 flex-none" :stroke-width="1.5" />
          <span class="flex-1">{{ t("settings.restart.message") }}</span>
          <Button data-testid="restart-now" @click="act({ type: 'restart' })">{{ t("common.restartNow") }}</Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
