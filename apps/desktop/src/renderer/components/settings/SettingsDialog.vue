<script setup lang="ts">
import { RotateCw, Search, X } from "@lucide/vue";
import { computed, nextTick, ref, watch } from "vue";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { rank } from "@/lib/search";
import { cn } from "@/lib/utils";
import type { RootSort, Startup } from "../../../shared/host-api";
import { PATCH_NOTES } from "../../../shared/patch-notes";
import { act, confirmAction, dialog, settingsOpen, settingsTarget, state, submitAction } from "../../host";
import { SHORTCUT_GROUPS } from "../../shortcuts";
import GameIcon from "../GameIcon.vue";
import AppearanceSection from "./AppearanceSection.vue";
import SegmentedControl from "./SegmentedControl.vue";
import { GROUPS, SECTION_LABEL, SETTINGS, type SettingsSection } from "./settings-index";
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
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const dateTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const formatDate = (iso: string) => dateFormat.format(new Date(iso));
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
    description: `In Trash until ${formatDate(entry.purgeAt)}`,
    keywords: [],
  }));
  return rank([...SETTINGS, ...trashed], query.value, (item) => ({
    name: item.label,
    extra: [item.description, SECTION_LABEL[item.section], ...item.keywords],
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
const grayscaleText = computed({
  get: () => library.value.grayscaleText,
  set: (enabled: boolean) => void act({ type: "set-grayscale-text", enabled }),
});
/** What the Updates row says, and what its button does. */
const updateRow = computed(() => {
  const u = state.value!.update;
  if (u.status === "checking") return { text: "Checking for a new version…", button: "Checking…", busy: true, run: null };
  if (u.status === "downloading") return { text: `Downloading ${u.version} in the background…`, button: "Downloading…", busy: true, run: null };
  if (u.status === "ready") return { text: `Version ${u.version} is ready. It installs when you close Tavora.`, button: "Restart now", busy: false, run: "restart-to-update" as const };
  if (u.status === "available") return { text: `Version ${u.version} is available.`, button: "Download", busy: false, run: "download-update" as const };
  const text = u.failed
    ? "Couldn't reach the update server. Try again in a moment."
    : u.checkedAt
      ? `You're up to date. Last checked ${dateTimeFormat.format(new Date(u.checkedAt))}.`
      : "Tavora checks for new versions by itself.";
  return { text, button: "Check now", busy: false, run: "check-for-updates" as const };
});
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
    title: `Delete ${name} for good?`,
    message: "Its workspace, notes and all other module data are deleted now. This cannot be undone.",
    confirm: "Delete for good",
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
      <nav class="bg-background flex w-60 flex-none flex-col gap-4 overflow-y-auto border-r p-3" aria-label="Settings sections">
        <DialogTitle class="px-3 pt-2 text-lg font-semibold">Settings</DialogTitle>
        <div class="relative">
          <Search class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" :stroke-width="1.5" />
          <input
            v-model="query"
            type="text"
            class="bg-card placeholder:text-muted-foreground focus-visible:ring-ring h-9 w-full rounded-lg border pr-3 pl-9 text-sm focus-visible:ring-2 focus-visible:outline-none"
            placeholder="Search settings"
            aria-label="Search settings"
            autocomplete="off"
            maxlength="80"
            data-testid="settings-search"
            @keydown="onSearchKey"
          />
        </div>
        <div v-for="group in GROUPS" :key="group.label" class="flex flex-col gap-0.5">
          <h3 class="text-muted-foreground px-3 pb-1 text-xs font-medium">{{ group.label }}</h3>
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
            <span class="flex-1">{{ item.label }}</span>
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
          title="See what changed in this version"
          data-testid="settings-version"
          @click="show('patch-notes')"
        >
          Tavora {{ version }}
        </button>
      </nav>

      <div class="relative flex min-w-0 flex-1 flex-col overflow-y-auto">
        <DialogClose as-child>
          <Button variant="ghost" size="icon" class="absolute top-4 right-4" data-testid="settings-close" aria-label="Close settings" title="Close">
            <X :stroke-width="1.5" />
          </Button>
        </DialogClose>

        <div class="max-w-[760px] px-10 py-10">
          <template v-if="query.trim()">
            <h2 class="mb-4 text-xl font-semibold">Search results</h2>
            <p v-if="!results.length" class="text-muted-foreground" data-testid="settings-no-results">No settings match "{{ query.trim() }}".</p>
            <ul v-else class="-mx-3 flex flex-col gap-1" aria-label="Search results" data-testid="settings-results">
              <li v-for="result in results" :key="result.id">
                <button
                  type="button"
                  class="hover:bg-accent focus-visible:bg-accent flex w-full flex-col gap-1 rounded-lg px-3 py-3 text-left"
                  :data-testid="`settings-result-${result.id}`"
                  @click="show(result.section, result.id)"
                >
                  <span class="text-muted-foreground text-xs font-medium">{{ SECTION_LABEL[result.section] }}</span>
                  <span class="font-medium">{{ result.label }}</span>
                  <span class="text-muted-foreground">{{ result.description }}</span>
                </button>
              </li>
            </ul>
          </template>

          <template v-else-if="section === 'general'">
            <h2 class="mb-4 text-xl font-semibold">General</h2>
            <SettingRow
              label="When Tavora starts"
              description="Show Home, or go straight back to the game you played last."
              setting="startup"
              :highlighted="highlight === 'startup'"
            >
              <SegmentedControl
                v-model="startup"
                label="When Tavora starts"
                :options="[
                  { value: 'welcome', label: 'Home', testid: 'startup-welcome' },
                  { value: 'last-game', label: 'Last game', testid: 'startup-last-game' },
                ]"
              />
            </SettingRow>
            <SettingRow
              label="Game list order"
              description="How games are sorted on the rail. In your own order, drag games to arrange them."
              setting="sort"
              :highlighted="highlight === 'sort'"
            >
              <SegmentedControl
                v-model="sort"
                label="Game list order"
                :options="[
                  { value: 'recent', label: 'Recently played', testid: 'sort-recent' },
                  { value: 'manual', label: 'My own order', testid: 'sort-manual' },
                ]"
              />
            </SettingRow>
            <SettingRow
              label="Grayscale text"
              description="Smooths text without colour fringes. Turn it on if text looks blurry on an OLED screen. Applies after a restart."
              setting="grayscale-text"
              :highlighted="highlight === 'grayscale-text'"
            >
              <Switch v-model="grayscaleText" aria-label="Grayscale text" data-testid="grayscale-text" />
            </SettingRow>
            <SettingRow
              label="Online game search"
              description="Finds more games than the built-in list on the Tavora service, and lets Tavora ask it for the icons of your games. It sees the text you type and which icons are asked for, keeps no log and knows nothing that identifies you. Turn it off to use the built-in games and your own icons only."
              setting="online-search"
              :highlighted="highlight === 'online-search'"
            >
              <Switch v-model="onlineSearch" aria-label="Online game search" data-testid="online-search" />
            </SettingRow>
            <SettingRow
              label="Download updates automatically"
              description="New versions of Tavora download in the background and install when you close the app. Turn it off to choose when to download."
              setting="auto-update"
              :highlighted="highlight === 'auto-update'"
            >
              <Switch v-model="autoUpdate" aria-label="Download updates automatically" data-testid="auto-update" />
            </SettingRow>
            <SettingRow
              label="Check for updates"
              :description="updateRow.text"
              setting="check-updates"
              :highlighted="highlight === 'check-updates'"
            >
              <Button variant="secondary" :disabled="updateRow.busy" data-testid="check-updates" @click="pressUpdateButton">{{ updateRow.button }}</Button>
            </SettingRow>
            <SettingRow
              label="Backups"
              description="Tavora keeps a copy of your games, layouts, notes and settings from the last 7 days, made when it first starts each day. To go back, close Tavora and copy the files from a day's folder over the originals."
              setting="backups"
              :highlighted="highlight === 'backups'"
            >
              <Button variant="secondary" data-testid="open-backups" @click="submitAction({ type: 'open-backups' })">Open folder</Button>
            </SettingRow>
            <SettingRow
              label="Game icons from this PC and Steam"
              description="Uses each game's own icon. Tavora reads it from the installed game on this PC (Battle.net, Epic, GOG, EA and other launchers), then from the Steam folder, then from the icons the Tavora service hosts (only while Online game search is on), and last downloads Steam's small icon for the game from Steam. Icons are kept on this PC. Games without an icon, and any image you pick yourself, are not affected. Turn it off to use the plain badges."
              setting="steam-icons"
              :highlighted="highlight === 'steam-icons'"
            >
              <Switch v-model="steamIcons" aria-label="Game icons from this PC and Steam" data-testid="steam-icons" />
            </SettingRow>
            <p class="text-muted-foreground -mt-2 mb-4 max-w-prose text-xs leading-relaxed" data-testid="icon-notice">
              Game names and icons belong to their publishers and are trademarks of their owners. Tavora is not affiliated with, endorsed by or sponsored by them. Icons are used only to identify the games, shown unchanged and never sold. A publisher can ask for a hosted icon to be removed, and it is removed: see the privacy page at mytavora.app.
            </p>
            <SettingRow
              label="Share game icons"
              description="Offer the icons your PC has for games Tavora does not have an icon for yet. You choose which, and see exactly what is sent. A person at Tavora checks each one before anyone else sees it. Needs Online game search."
              setting="share-icons"
              :highlighted="highlight === 'share-icons'"
            >
              <Button
                variant="secondary"
                data-testid="open-share-icons"
                :disabled="!library.onlineSearch || !library.steamIcons"
                @click="dialog = { kind: 'share-icons', gameIds: [] }"
              >
                Share…
              </Button>
            </SettingRow>
            <SettingRow

              label="Welcome tour"
              description="The short introduction Tavora shows on its first start: your profile, your first games and a few tips."
              setting="welcome-tour"
              :highlighted="highlight === 'welcome-tour'"
            >
              <Button variant="secondary" data-testid="show-welcome-again" @click="showWelcomeAgain">Show again</Button>
            </SettingRow>
          </template>

          <template v-else-if="section === 'appearance'">
            <AppearanceSection :highlight="highlight" />
          </template>

          <template v-else-if="section === 'shortcuts'">
            <h2
              :class="cn('-mx-3 rounded-lg px-3 text-xl font-semibold transition-colors duration-500', highlight === 'shortcuts' && 'bg-primary/10')"
              data-setting="shortcuts"
            >
              Keyboard shortcuts
            </h2>
            <p class="text-muted-foreground mt-2 mb-6">They work everywhere in Tavora, also while a module panel has focus. Ctrl+/ opens this list.</p>
            <div class="flex flex-col gap-6" data-testid="shortcuts">
              <section v-for="group in SHORTCUT_GROUPS" :key="group.title">
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
              Patch notes
            </h2>
            <p class="text-muted-foreground mt-2 mb-6">What changed in each version of Tavora, newest first.</p>
            <div class="flex flex-col gap-8" data-testid="patch-notes">
              <article v-for="entry in PATCH_NOTES" :key="entry.version" :data-testid="`patch-notes-${entry.version}`">
                <header class="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h3 class="text-lg font-semibold tabular-nums">{{ entry.version }}</h3>
                  <span v-if="entry.version === version" class="bg-secondary text-foreground rounded-sm px-1.5 py-0.5 text-xs">Installed</span>
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
              Trash
            </h2>
            <p class="text-muted-foreground mt-2 mb-4">Removed games and all their data stay here for 30 days, then they are deleted for good.</p>
            <div class="border-t" data-testid="trash">
              <p v-if="!library.trash.length" class="text-muted-foreground py-4" data-testid="trash-empty">Trash is empty.</p>
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
                    <span class="text-muted-foreground">Deleted for good on {{ formatDate(entry.purgeAt) }}</span>
                  </span>
                  <Button variant="secondary" :data-testid="`restore-${entry.game.id}`" @click="act({ type: 'restore-game', gameId: entry.game.id })">
                    Restore
                  </Button>
                  <Button variant="secondary" class="text-destructive" :data-testid="`delete-${entry.game.id}`" @click="deleteNow(entry.game.id, entry.game.name)">
                    Delete now
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
          <span class="flex-1">Some changes apply after a restart.</span>
          <Button data-testid="restart-now" @click="act({ type: 'restart' })">Restart now</Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
