<script setup lang="ts">
// Settings: a short menu of pages in groups on the left, with a search that finds any setting, and About & updates
// at its foot; the chosen page on the right, under a title that stays put while it scrolls. A page that opens from a
// row (SUB_PAGES) has a way back in its title; the developer pages are tabs under one entry. Each page is its own
// component; settings-index.ts lists them and every setting the search can find.
import { Info, RotateCw, Search, X } from "@lucide/vue";
import { computed, nextTick, provide, ref, watch } from "vue";
import { Badge } from "@tavora/official-ui/components/ui/badge";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@tavora/official-ui/components/ui/dialog";
import { Input } from "@tavora/official-ui/components/ui/input";
import { NavList, type NavGroup } from "@tavora/official-ui/components/ui/nav-list";
import { Tabs, TabsList, TabsTrigger } from "@tavora/official-ui/components/ui/tabs";
import { rank } from "@/lib/search";
import { cn } from "@/lib/utils";
import { act, hiddenSettingIds, hiddenSettings, makesModules, openSettings, refreshReleaseStatuses, releasePendingCount, settingsOpen, settingsTarget, state } from "../../host";
import { formatDate, t } from "../../i18n";
import AboutSection from "./AboutSection.vue";
import AppearanceSection from "./AppearanceSection.vue";
import BrowserSection from "./BrowserSection.vue";
import ConnectionsSection from "./ConnectionsSection.vue";
import DevelopmentSection from "./DevelopmentSection.vue";
import DevFoldersSection from "./DevFoldersSection.vue";
import DevHelpSection from "./DevHelpSection.vue";
import DevPublishingSection from "./DevPublishingSection.vue";
import GamesSection from "./GamesSection.vue";
import GeneralSection from "./GeneralSection.vue";
import ModulesSection from "./ModulesSection.vue";
import OverlaysSection from "./OverlaysSection.vue";
import PatchNotesSection from "./PatchNotesSection.vue";
import ShortcutsSection from "./ShortcutsSection.vue";
import TrashSection from "./TrashSection.vue";
import WorkspacesSection from "./WorkspacesSection.vue";
import { hasNewSettings, markSeen } from "./new-settings";
import {
  DEVELOPER_SECTIONS,
  DEVELOPER_TABS,
  GROUPS,
  SUB_PAGES,
  groupLabel,
  menuEntry,
  menuLabel,
  sectionLabel,
  settingEntries,
  type SettingsPlace,
  type SettingsSection,
} from "./settings-index";
import { SETTINGS_PAGE_TITLE } from "./settings-page";

const section = ref<SettingsSection>("general");
const query = ref("");
/** Settings opens with the search focused, so typing searches; it shows its focus ring only once the user uses it. */
const searchUsed = ref(false);
/** The menu entry lit for the page. */
const entry = computed(() => menuEntry(section.value));
/** The page a sub-page opened from, for the way back in its title. */
const parent = computed<SettingsSection | null>(() => (section.value in SUB_PAGES ? SUB_PAGES[section.value as keyof typeof SUB_PAGES] : null));
/** The developer tabs show once the user makes modules; before, the page is Make modules with Let's go. */
const devTabs = computed(() => entry.value === "development" && makesModules.value);

/** What the page header says; a group with the same title leaves its own out. */
const pageTitle = computed(() => (query.value.trim() ? t("settings.results.title") : parent.value ? sectionLabel(section.value) : menuLabel(section.value, makesModules.value)));
provide(SETTINGS_PAGE_TITLE, pageTitle);
/** The setting a search result led to, tinted for a moment. */
const highlight = ref<string | null>(null);
let highlightTimer: ReturnType<typeof setTimeout> | undefined;
/** The page's scrolling area, back at the top for every new page. */
const scroller = ref<HTMLElement | null>(null);

// Settings opens where it was asked to: its first page, or a setting found with Ctrl+K.
watch(settingsOpen, (open) => {
  if (!open) {
    markSeen(section.value);
    return;
  }
  query.value = "";
  searchUsed.value = false;
  void show(settingsTarget.value.section, settingsTarget.value.setting);
  void refreshReleaseStatuses();
});
// Asked again while open (e.g. Ctrl+/ over Settings): go there.
watch(settingsTarget, (target) => {
  if (settingsOpen.value) void show(target.section, target.setting);
});

async function show(target: SettingsSection, setting?: string) {
  // A search led someone who doesn't make modules yet to a developer page: that is a start, so the tabs show.
  if (!makesModules.value && (DEVELOPER_SECTIONS as readonly string[]).includes(target)) void act({ type: "set-makes-modules", on: true }, { quiet: true });
  // New marks of the page left go now; they stayed while the user was on it.
  if (target !== section.value) markSeen(section.value);
  section.value = target;
  query.value = "";
  clearTimeout(highlightTimer);
  highlight.value = setting ?? null;
  await nextTick();
  if (!setting) {
    scroller.value?.scrollTo({ top: 0 });
    return;
  }
  document.querySelector(`[data-setting="${CSS.escape(setting)}"]`)?.scrollIntoView({ block: "center" });
  highlightTimer = setTimeout(() => (highlight.value = null), 2000);
}

/** Each group's plate colour (styles.css): the accent for Tavora, turned around the wheel for the others. */
const PLATE_TURN: Record<string, string | undefined> = { modules: "nav-plate-turn-1", development: "nav-plate-turn-2" };

const library = computed(() => state.value!.library);

/** The pages on the left, in their groups: a counter shows what waits for Publish, a New mark what's new. */
const navGroups = computed<NavGroup[]>(() =>
  GROUPS.map((group) => ({
    heading: groupLabel(group.id),
    icon: group.icon,
    class: PLATE_TURN[group.id],
    items: group.sections.map((item) => {
      const fresh = item.id !== entry.value && hasNewSettings(item.id);
      return {
        id: item.id,
        label: menuLabel(item.id, makesModules.value),
        icon: item.icon,
        badge: item.id === "development" && releasePendingCount.value ? releasePendingCount.value : fresh ? t("settings.new") : undefined,
        badgeAccent: fresh && !(item.id === "development" && releasePendingCount.value),
        badgeTestid: item.id === "development" && releasePendingCount.value ? "settings-nav-development-count" : fresh ? `settings-nav-${item.id}-new` : undefined,
        testid: `settings-nav-${item.id}`,
      };
    }),
  })),
);
const version = computed(() => state.value!.appVersion);

/** Where a result is: its page, or for a page opened from a row, the way there. */
function placeLabel(place: SettingsPlace): string {
  if (place === "account") return `${t("profile.label")} › ${sectionLabel(place)}`;
  if (place in SUB_PAGES) return `${menuLabel(SUB_PAGES[place as keyof typeof SUB_PAGES])} › ${sectionLabel(place)}`;
  if ((DEVELOPER_TABS as readonly string[]).includes(place) && place !== "development") return `${menuLabel(place)} › ${sectionLabel(place)}`;
  return menuLabel(place, makesModules.value);
}

interface Result {
  id: string;
  section: SettingsPlace;
  label: string;
  description: string;
  keywords: string[];
}

// Settings, plus the workspaces in Trash, so "valheim" finds a removed one.
const results = computed<Result[]>(() => {
  if (!query.value.trim()) return [];
  const trashed = library.value.trash.map((item) => ({
    id: `trash-${item.workspace.id}`,
    section: "trash" as const,
    label: item.workspace.name,
    description: t("settings.results.trashUntil", { date: formatDate(item.purgeAt) }),
    keywords: [],
  }));
  return rank([...settingEntries(hiddenSettings.value, hiddenSettingIds.value), ...trashed], query.value, (item) => ({
    name: item.label,
    extra: [item.description, placeLabel(item.section), ...item.keywords],
  }));
});

/** A result leads to its page; the account is in the profile dialog. */
function open(result: Result) {
  if (result.section === "account") openSettings({ section: "account", setting: result.id });
  else void show(result.section, result.id);
}

const resultsAnnouncement = computed(() => {
  const text = query.value.trim();
  if (!text) return "";
  return results.value.length ? t("settings.results.count", { count: results.value.length }) : t("settings.results.none", { query: text });
});

function onSearchKey(event: KeyboardEvent) {
  if (event.key === "Escape" && query.value) {
    // Clear the search first; a second Escape closes Settings.
    event.preventDefault();
    event.stopPropagation();
    query.value = "";
  } else if (event.key === "Enter" && results.value[0]) {
    open(results.value[0]);
  }
}
</script>

<template>
  <Dialog v-model:open="settingsOpen">
    <DialogContent
      class="bg-card flex top-[calc(50%+env(titlebar-area-height,0px)/2)] h-[min(880px,calc(100vh-env(titlebar-area-height,0px)-48px))] w-[min(1240px,calc(100vw-48px))] max-w-none gap-0 overflow-hidden p-0 sm:max-w-none"
      data-testid="settings"
      :show-close-button="false"
      :aria-describedby="undefined"
    >
      <div class="thin-scroll settings-menu bg-background flex w-56 flex-none flex-col gap-3 overflow-y-auto border-r px-4 pb-4 lg:w-64">
        <div class="relative flex h-16 flex-none items-center">
          <Search class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" :stroke-width="1.5" aria-hidden="true" />
          <Input
            v-model="query"
            type="text"
            :class="cn('h-10 pr-3 pl-9', !searchUsed && 'focus-visible:border-input focus-visible:ring-0')"
            :placeholder="t('settings.search')"
            :aria-label="t('settings.search')"
            autocomplete="off"
            maxlength="80"
            data-testid="settings-search"
            @keydown="onSearchKey"
            @pointerdown="searchUsed = true"
            @input="searchUsed = true"
            @blur="searchUsed = true"
          />
        </div>
        <NavList
          :model-value="query ? null : entry"
          :label="t('settings.sections')"
          :groups="navGroups"
          class="nav-plates gap-2.5"
          group-class="rounded-xl border p-1"
          heading-class="pt-1"
          @select="(id: string) => show(id as SettingsSection)"
        />
        <!-- About & updates, with the version: rarely needed, so it sits at the foot. -->
        <button
          type="button"
          :class="
            cn(
              'text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-ring mt-auto flex h-9 flex-none items-center gap-3 rounded-lg px-3 text-left text-sm outline-none focus-visible:outline-2 focus-visible:-outline-offset-2',
              !query && entry === 'about' && 'bg-primary/10 text-foreground',
            )
          "
          :aria-current="!query && entry === 'about' ? 'page' : undefined"
          :aria-label="`${t('settings.section.about')}, Tavora ${version}`"
          data-testid="settings-nav-about"
          @click="show('about')"
        >
          <Info class="size-4 flex-none" :stroke-width="1.75" aria-hidden="true" />
          <span class="min-w-0 flex-1 truncate">{{ t("settings.section.about") }}</span>
          <span class="text-xs tabular-nums" data-testid="settings-version">{{ version }}</span>
        </button>
      </div>

      <div class="flex min-w-0 flex-1 flex-col">
        <header
          :class="cn('flex h-16 flex-none items-center justify-between gap-4 border-b px-6 transition-colors duration-500 lg:px-10', highlight === section && 'bg-primary/10')"
          :data-setting="section"
        >
          <!-- Where you are: Settings / the page, with the page a sub-page opened from in between. -->
          <div class="flex min-w-0 items-center gap-2.5 text-base">
            <DialogTitle class="text-muted-foreground flex-none text-base font-medium">{{ t("settings.title") }}</DialogTitle>
            <span class="text-muted-foreground/60 flex-none" aria-hidden="true">/</span>
            <template v-if="parent && !query.trim()">
              <button type="button" class="text-muted-foreground hover:text-foreground flex-none rounded-md font-medium" data-testid="settings-back" @click="show(parent)">
                {{ menuLabel(parent) }}
              </button>
              <span class="text-muted-foreground/60 flex-none" aria-hidden="true">/</span>
            </template>
            <h2 class="truncate font-semibold" data-testid="settings-heading">{{ pageTitle }}</h2>
          </div>
          <DialogClose as-child>
            <Button variant="ghost" size="icon" class="flex-none" data-testid="settings-close" :aria-label="t('settings.close')" :title="t('common.close')">
              <X :stroke-width="1.5" />
            </Button>
          </DialogClose>
        </header>

        <!-- Always there, so a screen reader hears how many results each search finds. Outside the page, so the
             first group sits right under the header. -->
        <p class="sr-only" role="status">{{ resultsAnnouncement }}</p>
        <div ref="scroller" class="thin-scroll relative min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]" data-testid="settings-body">
          <div class="px-6 pt-6 pb-12 lg:px-10">
            <template v-if="query.trim()">
              <p v-if="!results.length" class="text-muted-foreground" data-testid="settings-no-results">{{ t("settings.results.none", { query: query.trim() }) }}</p>
              <ul v-else class="-mx-3 flex flex-col gap-1" :aria-label="t('settings.results.title')" data-testid="settings-results">
                <li v-for="result in results" :key="result.id">
                  <button
                    type="button"
                    class="hover:bg-accent focus-visible:bg-accent flex w-full flex-col gap-1 rounded-lg px-3 py-3 text-left"
                    :data-testid="`settings-result-${result.id}`"
                    @click="open(result)"
                  >
                    <span class="text-primary text-xs font-medium">{{ placeLabel(result.section) }}</span>
                    <span class="font-medium">{{ result.label }}</span>
                    <span class="text-muted-foreground text-sm">{{ result.description }}</span>
                  </button>
                </li>
              </ul>
            </template>
            <template v-else>
              <!-- The developer pages, as tabs; Your modules counts what waits for Publish. -->
              <Tabs v-if="devTabs" :model-value="section" class="mb-6" @update:model-value="(id) => show(id as SettingsSection)">
                <TabsList class="h-10 w-full justify-start gap-2" :aria-label="t('settings.nav.development')">
                  <TabsTrigger v-for="tab in DEVELOPER_TABS" :key="tab" :value="tab" class="px-3" :data-testid="`settings-tab-${tab}`">
                    {{ sectionLabel(tab) }}
                    <Badge v-if="tab === 'development' && releasePendingCount" variant="secondary" class="text-primary py-0 tabular-nums">{{ releasePendingCount }}</Badge>
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              <GeneralSection v-if="section === 'general'" :highlight="highlight" />
              <AppearanceSection v-else-if="section === 'appearance'" :highlight="highlight" />
              <GamesSection v-else-if="section === 'games'" :highlight="highlight" @show="show" />
              <ShortcutsSection v-else-if="section === 'shortcuts'" />
              <ModulesSection v-else-if="section === 'modules'" :highlight="highlight" />
              <ConnectionsSection v-else-if="section === 'connections'" :highlight="highlight" />
              <OverlaysSection v-else-if="section === 'overlays'" :highlight="highlight" />
              <BrowserSection v-else-if="section === 'browser'" :highlight="highlight" />
              <DevelopmentSection v-else-if="section === 'development'" :highlight="highlight" @show="show" />
              <DevFoldersSection v-else-if="section === 'dev-folders'" :highlight="highlight" />
              <DevPublishingSection v-else-if="section === 'dev-publishing'" :highlight="highlight" />
              <DevHelpSection v-else-if="section === 'dev-help'" :highlight="highlight" />
              <AboutSection v-else-if="section === 'about'" :highlight="highlight" @patch-notes="show('patch-notes')" />
              <WorkspacesSection v-else-if="section === 'workspaces'" :highlight="highlight" />
              <TrashSection v-else-if="section === 'trash'" :highlight="highlight" />
              <PatchNotesSection v-else-if="section === 'patch-notes'" />
            </template>
          </div>
        </div>

        <!-- Settings that apply on start share one bar, so several changes need one restart. -->
        <div v-if="state!.restartPending" class="bg-card flex flex-none flex-wrap items-center gap-x-4 gap-y-2 border-t px-6 py-3 lg:px-10" role="status" data-testid="restart-bar">
          <RotateCw class="text-primary size-4 flex-none" :stroke-width="1.5" />
          <span class="flex-1">{{ t("settings.restart.message") }}</span>
          <Button data-testid="restart-now" @click="act({ type: 'restart' })">{{ t("common.restartNow") }}</Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
/* The menu fits a normal window; there it scrolls by wheel or keys without a bar beside it. */
@media (min-height: 640px) {
  .settings-menu::-webkit-scrollbar {
    width: 0;
  }
}
</style>
