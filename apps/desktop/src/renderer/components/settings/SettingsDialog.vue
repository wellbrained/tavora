<script setup lang="ts">
// Settings: the sections in groups on the left, with a search that finds any setting; the chosen
// section on the right, under a title that stays put while it scrolls. Each section is its own
// component; settings-index.ts lists them and every setting the search can find.
import { RotateCw, ScrollText, Search, Settings as SettingsIcon, X } from "@lucide/vue";
import { computed, nextTick, ref, watch } from "vue";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { rank } from "@/lib/search";
import { cn } from "@/lib/utils";
import { act, hiddenSettings, settingsOpen, settingsTarget, state } from "../../host";
import { formatDate, t } from "../../i18n";
import AboutSection from "./AboutSection.vue";
import AccountSection from "./AccountSection.vue";
import AppearanceSection from "./AppearanceSection.vue";
import BrowserSection from "./BrowserSection.vue";
import DevelopmentSection from "./DevelopmentSection.vue";
import GamesSection from "./GamesSection.vue";
import GeneralSection from "./GeneralSection.vue";
import IntegrationsSection from "./IntegrationsSection.vue";
import ModulesSection from "./ModulesSection.vue";
import OnlineSection from "./OnlineSection.vue";
import PatchNotesSection from "./PatchNotesSection.vue";
import ShortcutsSection from "./ShortcutsSection.vue";
import TrashSection from "./TrashSection.vue";
import { GROUPS, groupLabel, sectionLabel, settingEntries, type SettingsSection } from "./settings-index";

/** The icon shown in the page header: the section's own, a magnifier for search results. */
const headerIcon = computed(() => {
  if (query.value.trim()) return Search;
  if (section.value === "patch-notes") return ScrollText;
  for (const group of GROUPS) for (const item of group.sections) if (item.id === section.value) return item.icon;
  return SettingsIcon;
});

const section = ref<SettingsSection>("general");
const query = ref("");
/** The setting a search result led to, tinted for a moment. */
const highlight = ref<string | null>(null);
let highlightTimer: ReturnType<typeof setTimeout> | undefined;
/** The section's scrolling area, back at the top for every new section. */
const scroller = ref<HTMLElement | null>(null);

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
  await nextTick();
  if (!setting) {
    scroller.value?.scrollTo({ top: 0 });
    return;
  }
  document.querySelector(`[data-setting="${CSS.escape(setting)}"]`)?.scrollIntoView({ block: "center" });
  highlightTimer = setTimeout(() => (highlight.value = null), 2000);
}

const library = computed(() => state.value!.library);
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
  return rank([...settingEntries(hiddenSettings.value), ...trashed], query.value, (item) => ({
    name: item.label,
    extra: [item.description, sectionLabel(item.section), ...item.keywords],
  }));
});

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
    void show(results.value[0].section, results.value[0].id);
  }
}
</script>

<template>
  <Dialog v-model:open="settingsOpen">
    <DialogContent
      class="bg-card flex h-[min(880px,calc(100vh-48px))] w-[min(1240px,calc(100vw-48px))] max-w-none gap-0 overflow-hidden p-0 sm:max-w-none"
      data-testid="settings"
      :show-close-button="false"
      :aria-describedby="undefined"
    >
      <nav class="bg-background flex w-56 flex-none flex-col gap-5 overflow-y-auto border-r p-4 lg:w-64" :aria-label="t('settings.sections')">
        <DialogTitle class="px-2 pt-1 text-xl font-semibold">{{ t("settings.title") }}</DialogTitle>
        <div class="relative">
          <Search class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" :stroke-width="1.5" aria-hidden="true" />
          <Input
            v-model="query"
            type="text"
            class="h-10 pr-3 pl-9"
            :placeholder="t('settings.search')"
            :aria-label="t('settings.search')"
            autocomplete="off"
            maxlength="80"
            data-testid="settings-search"
            @keydown="onSearchKey"
          />
        </div>
        <div v-for="group in GROUPS" :key="group.id" class="flex flex-col gap-0.5">
          <h3 class="text-muted-foreground px-3 pb-1 text-xs font-semibold tracking-wider uppercase">{{ groupLabel(group.id) }}</h3>
          <button
            v-for="item in group.sections.filter((entry) => !hiddenSettings.has(entry.id))"
            :key="item.id"
            type="button"
            :class="
              cn(
                'text-muted-foreground hover:bg-accent hover:text-foreground group flex h-9 items-center gap-3 rounded-lg px-3 text-left font-medium',
                !query && section === item.id && 'bg-primary/10 text-foreground hover:bg-primary/15',
              )
            "
            :data-testid="`settings-nav-${item.id}`"
            :aria-current="!query && section === item.id ? 'page' : undefined"
            @click="show(item.id)"
          >
            <component :is="item.icon" :class="cn('size-4 flex-none transition-colors', !query && section === item.id ? 'text-primary' : 'group-hover:text-primary/80')" :stroke-width="1.75" />
            <span class="flex-1">{{ sectionLabel(item.id) }}</span>
            <span v-if="item.id === 'trash' && library.trash.length" class="text-muted-foreground text-xs tabular-nums">{{ library.trash.length }}</span>
          </button>
        </div>
        <button
          type="button"
          :class="
            cn(
              'text-muted-foreground hover:bg-accent hover:text-foreground mt-auto rounded-lg px-3 py-2 text-left text-xs tabular-nums',
              !query && section === 'patch-notes' && 'bg-primary/10 text-foreground',
            )
          "
          :title="t('settings.version')"
          :aria-label="`Tavora ${version}, ${t('settings.version')}`"
          data-testid="settings-version"
          @click="show('patch-notes')"
        >
          Tavora {{ version }}
        </button>
      </nav>

      <div class="flex min-w-0 flex-1 flex-col">
        <header
          :class="cn('flex h-[72px] flex-none items-center justify-between gap-4 border-b px-6 transition-colors duration-500 lg:px-10', highlight === section && 'bg-primary/10')"
          :data-setting="section"
        >
          <div class="flex min-w-0 items-center gap-3">
            <span class="bg-primary/15 text-primary flex size-9 flex-none items-center justify-center rounded-lg" aria-hidden="true">
              <component :is="headerIcon" class="size-5" :stroke-width="1.75" />
            </span>
            <h2 class="truncate text-xl font-semibold" data-testid="settings-heading">{{ query.trim() ? t("settings.results.title") : sectionLabel(section) }}</h2>
          </div>
          <DialogClose as-child>
            <Button variant="ghost" size="icon" class="flex-none" data-testid="settings-close" :aria-label="t('settings.close')" :title="t('common.close')">
              <X :stroke-width="1.5" />
            </Button>
          </DialogClose>
        </header>

        <div ref="scroller" class="relative min-h-0 flex-1 overflow-y-auto" data-testid="settings-body">
          <div class="px-6 pt-8 pb-12 lg:px-10">
            <!-- Always there, so a screen reader hears how many results each search finds. -->
            <p class="sr-only" role="status">{{ resultsAnnouncement }}</p>
            <template v-if="query.trim()">
              <p v-if="!results.length" class="text-muted-foreground" data-testid="settings-no-results">{{ t("settings.results.none", { query: query.trim() }) }}</p>
              <ul v-else class="-mx-3 flex flex-col gap-1" :aria-label="t('settings.results.title')" data-testid="settings-results">
                <li v-for="result in results" :key="result.id">
                  <button
                    type="button"
                    class="hover:bg-accent focus-visible:bg-accent flex w-full flex-col gap-1 rounded-lg px-3 py-3 text-left"
                    :data-testid="`settings-result-${result.id}`"
                    @click="show(result.section, result.id)"
                  >
                    <span class="text-primary text-xs font-medium">{{ sectionLabel(result.section) }}</span>
                    <span class="font-medium">{{ result.label }}</span>
                    <span class="text-muted-foreground text-sm">{{ result.description }}</span>
                  </button>
                </li>
              </ul>
            </template>
            <AccountSection v-else-if="section === 'account'" :highlight="highlight" />
            <GeneralSection v-else-if="section === 'general'" :highlight="highlight" />
            <AppearanceSection v-else-if="section === 'appearance'" :highlight="highlight" />
            <OnlineSection v-else-if="section === 'online'" :highlight="highlight" />
            <ShortcutsSection v-else-if="section === 'shortcuts'" />
            <AboutSection v-else-if="section === 'about'" :highlight="highlight" @patch-notes="show('patch-notes')" />
            <ModulesSection v-else-if="section === 'modules'" :highlight="highlight" />
            <IntegrationsSection v-else-if="section === 'integrations'" :highlight="highlight" />
            <BrowserSection v-else-if="section === 'browser'" :highlight="highlight" />
            <DevelopmentSection v-else-if="section === 'development'" :highlight="highlight" />
            <GamesSection v-else-if="section === 'games'" :highlight="highlight" />
            <TrashSection v-else-if="section === 'trash'" :highlight="highlight" />
            <PatchNotesSection v-else-if="section === 'patch-notes'" />
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
