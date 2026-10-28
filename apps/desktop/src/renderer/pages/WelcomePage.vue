<script setup lang="ts">
// Home, between sessions: a search field that opens Ctrl+K, the running game (or the last one) to continue, the other
// recent games, and beside it what happened while the user was away: module updates waiting for their OK, new
// messages and a new version of Tavora. With nothing new that list is one quiet line.
import { Plus, Search } from "@lucide/vue";
import { computed, ref } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Kbd } from "@tavora/official-ui/components/ui/kbd";
import WorkspaceIcon from "../components/WorkspaceIcon.vue";
import { act, dialog, inbox, openInbox, openSearch, openSettings, state } from "../host";
import { formatAgo, t } from "../i18n";
import { MOD } from "../shortcuts";

const library = computed(() => state.value!.library);
const empty = computed(() => Object.keys(library.value.workspaces).length === 0);

const running = computed(() => {
  const id = state.value!.runningGameId;
  return id ? (library.value.workspaces[id] ?? null) : null;
});
const recentAll = computed(() => library.value.recent.map((id) => library.value.workspaces[id]!).filter(Boolean));
/** The game to continue: the one running, otherwise the one opened last. */
const featured = computed(() => running.value ?? recentAll.value[0] ?? null);
const recent = computed(() => recentAll.value.filter((workspace) => workspace.id !== featured.value?.id));

const opened = (at: string | null) => (at ? t("welcome.opened", { ago: formatAgo(Date.parse(at)) }) : t("welcome.neverOpened"));
/** Under a recent game's icon there is room for the time alone. */
const ago = (at: string | null) => (at ? formatAgo(Date.parse(at)) : t("welcome.neverOpened"));

// Typing into the field hands the text to the Ctrl+K search, which takes over from there.
const typed = ref("");
function handOver() {
  openSearch(typed.value);
  typed.value = "";
}

const quick = computed(() => [
  { id: "add-game", label: t("common.addGame"), run: () => (dialog.value = { kind: "add-game" }) },
  { id: "appearance", label: t("settings.section.appearance"), run: () => openSettings({ section: "appearance" }) },
  { id: "shortcuts", label: t("settings.section.shortcuts"), run: () => openSettings({ section: "shortcuts" }) },
  { id: "patch-notes", label: t("settings.section.patch-notes"), run: () => openSettings({ section: "patch-notes" }) },
]);

interface AwayItem {
  id: string;
  title: string;
  text: string;
  action: string;
  run: () => unknown;
  /** Something from Tavora itself rather than from the user's modules or messages: a quieter dot. */
  quiet?: boolean;
}

const away = computed<AwayItem[]>(() => {
  const items: AwayItem[] = [];
  const waiting = state.value!.modules.filter((module) => module.update);
  if (waiting.length) {
    items.push({
      id: "updates",
      title: t("welcome.away.updates", { count: waiting.length }),
      text: t("welcome.away.updatesText", { names: waiting.map((module) => module.name).join(", ") }),
      action: t("welcome.away.updatesAction"),
      run: () => (dialog.value = { kind: "add-module", view: "updates" }),
    });
  }
  if (inbox.value.unread) {
    items.push({
      id: "messages",
      title: t("welcome.away.messages", { count: inbox.value.unread }),
      text: t("welcome.away.messagesText"),
      action: t("welcome.away.messagesAction"),
      run: () => openInbox(),
    });
  }
  const update = state.value!.update;
  if (update.status === "available" || update.status === "downloading" || update.status === "ready") {
    items.push({
      id: "app",
      title: t("welcome.away.app", { version: update.version }),
      text: t(`welcome.away.app.${update.status}`),
      action: update.status === "downloading" ? "" : t(`welcome.away.appAction.${update.status}`),
      run: () => act({ type: update.status === "ready" ? "restart-to-update" : "download-update" }),
      quiet: true,
    });
  }
  return items;
});
</script>

<template>
  <main class="@container h-full overflow-y-auto px-12 pt-16 pb-10" data-testid="welcome">
    <section v-if="empty" class="flex flex-col items-center gap-4 text-center">
      <img class="mb-2" src="/brand/emblem-240.png" alt="" width="111" height="120" draggable="false" />
      <h1 class="text-3xl font-semibold">{{ t("welcome.title.new") }}</h1>
      <p class="text-muted-foreground mb-4">{{ t("welcome.tagline") }}</p>
      <p>{{ t("welcome.addFirst") }}</p>
      <Button data-testid="welcome-add-game" @click="dialog = { kind: 'add-game' }">
        <Plus :stroke-width="1.5" /> {{ t("common.addGame") }}
      </Button>
    </section>

    <div v-else class="grid grid-cols-[minmax(0,680px)] justify-center gap-x-12 @min-[1048px]:grid-cols-[minmax(0,680px)_320px]">
      <header class="pb-7 text-center @min-[1048px]:col-start-1 @min-[1048px]:row-start-1">
        <img class="mx-auto mb-3" src="/brand/emblem-240.png" alt="" width="64" height="69" draggable="false" />
        <h1 class="text-2xl font-semibold">{{ t("welcome.title.back") }}</h1>
        <p class="text-muted-foreground mt-1.5">{{ t("welcome.tagline") }}</p>
      </header>

      <div class="flex min-w-0 flex-col @min-[1048px]:col-start-1 @min-[1048px]:row-start-2">
        <label class="bg-card border-input focus-within:border-primary flex h-14 cursor-text items-center gap-3.5 rounded-xl border px-4.5 transition-colors">
          <Search class="text-muted-foreground size-5 shrink-0" :stroke-width="1.5" />
          <input
            v-model="typed"
            class="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-base focus-visible:outline-none"
            :placeholder="t('welcome.search')"
            :aria-label="t('welcome.search')"
            autocomplete="off"
            spellcheck="false"
            data-testid="welcome-search"
            @input="handOver"
            @keydown.enter.prevent="openSearch()"
          />
          <span class="flex shrink-0 gap-1" aria-hidden="true"><Kbd>{{ MOD() }}</Kbd><Kbd>K</Kbd></span>
        </label>
        <ul class="mt-3 flex flex-wrap justify-center gap-2" :aria-label="t('welcome.quick')">
          <li v-for="item in quick" :key="item.id">
            <Button variant="outline" size="sm" class="text-muted-foreground hover:text-foreground rounded-full" :data-testid="`welcome-quick-${item.id}`" @click="item.run()">
              {{ item.label }}
            </Button>
          </li>
        </ul>

        <section
          v-if="featured"
          class="border-primary/35 from-primary/12 to-card mt-9 flex items-center gap-3.5 rounded-xl border bg-linear-to-r px-4.5 py-3.5"
          :aria-label="featured.name"
          data-testid="welcome-continue"
        >
          <WorkspaceIcon :workspace="featured" :size="44" />
          <div class="min-w-0 flex-1">
            <p class="flex items-center gap-1.5 truncate font-semibold">
              <span v-if="running" class="bg-success size-2 shrink-0 rounded-full" aria-hidden="true" />
              {{ running ? t("rail.running", { name: featured.name }) : featured.name }}
            </p>
            <p class="text-muted-foreground truncate text-xs">{{ running ? t("welcome.runningText") : opened(featured.lastOpenedAt) }}</p>
          </div>
          <Button size="lg" class="shrink-0 px-5 font-semibold" data-testid="welcome-continue-button" @click="act({ type: 'open-workspace', workspaceId: featured.id })">
            {{ t("welcome.continue") }}
          </Button>
        </section>

        <section class="mt-8" aria-labelledby="recent-title">
          <h2 id="recent-title" class="text-muted-foreground mb-3 text-xs font-medium tracking-wide uppercase">{{ t("welcome.recent") }}</h2>
          <ul class="grid grid-cols-[repeat(auto-fill,minmax(124px,1fr))] gap-3">
            <li v-for="workspace in recent" :key="workspace.id">
              <button
                type="button"
                class="hover:bg-card flex w-full flex-col items-center gap-2 rounded-lg px-1.5 py-3"
                :data-testid="`recent-${workspace.id}`"
                @click="act({ type: 'open-workspace', workspaceId: workspace.id })"
              >
                <WorkspaceIcon :workspace="workspace" :size="72" />
                <span class="max-w-full truncate text-sm font-medium">{{ workspace.name }}</span>
                <span class="text-muted-foreground max-w-full truncate text-xs">{{ ago(workspace.lastOpenedAt) }}</span>
              </button>
            </li>
            <li>
              <button
                type="button"
                class="hover:bg-card flex w-full flex-col items-center gap-2 rounded-lg px-1.5 py-3"
                data-testid="welcome-add-game"
                @click="dialog = { kind: 'add-game' }"
              >
                <span class="border-input text-muted-foreground grid size-18 place-items-center rounded-2xl border border-dashed">
                  <Plus class="size-6" :stroke-width="1.5" />
                </span>
                <span class="text-muted-foreground text-sm">{{ t("common.addGame") }}</span>
              </button>
            </li>
          </ul>
        </section>
      </div>

      <!-- Its first card lines up with the search field; on a wide window the heading sits above that line. -->
      <aside
        class="relative mt-10 flex flex-col gap-3 @min-[1048px]:mt-0 @min-[1048px]:col-start-2 @min-[1048px]:row-start-2 @min-[1048px]:self-stretch @min-[1048px]:justify-start @min-[1048px]:border-l @min-[1048px]:pl-8"
        aria-labelledby="away-title"
        data-testid="welcome-away"
      >
        <h2 id="away-title" class="text-muted-foreground text-xs font-medium tracking-wide uppercase @min-[1048px]:absolute @min-[1048px]:bottom-full @min-[1048px]:mb-3">
          {{ t("welcome.away.title") }}
        </h2>
        <div v-for="item in away" :key="item.id" class="bg-card flex items-start gap-3 rounded-xl border px-4 py-3.5" :data-testid="`welcome-away-${item.id}`">
          <span :class="['mt-1.5 size-2 shrink-0 rounded-full', item.quiet ? 'bg-muted-foreground' : 'bg-primary']" aria-hidden="true" />
          <div class="min-w-0">
            <p class="font-semibold">{{ item.title }}</p>
            <p class="text-muted-foreground mt-0.5 text-xs">{{ item.text }}</p>
            <Button v-if="item.action" variant="link" class="mt-1 h-auto p-0 text-xs font-semibold" @click="item.run()">{{ item.action }}</Button>
          </div>
        </div>
        <p v-if="!away.length" class="text-muted-foreground text-xs" data-testid="welcome-away-quiet">{{ t("welcome.away.quiet") }}</p>
      </aside>
    </div>
  </main>
</template>
