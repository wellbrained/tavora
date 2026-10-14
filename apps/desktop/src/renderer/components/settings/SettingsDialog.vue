<script setup lang="ts">
import { SlidersHorizontal, Trash2, X } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { RootSort, Startup } from "../../../shared/host-api";
import { act, confirmAction, settingsOpen, state, submitAction } from "../../host";
import GameIcon from "../GameIcon.vue";
import SegmentedControl from "./SegmentedControl.vue";
import SettingRow from "./SettingRow.vue";

// The section menu, in groups. New settings get a row in a section, or a
// new section here, rather than a longer page.
const GROUPS = [
  { label: "Tavora", sections: [{ id: "general", label: "General", icon: SlidersHorizontal }] },
  { label: "Library", sections: [{ id: "trash", label: "Trash", icon: Trash2 }] },
] as const;
type Section = (typeof GROUPS)[number]["sections"][number]["id"];

const section = ref<Section>("general");
// Settings always opens on its first section.
watch(settingsOpen, (open) => {
  if (open) section.value = "general";
});

const library = computed(() => state.value!.library);
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const formatDate = (iso: string) => dateFormat.format(new Date(iso));

const startup = computed({
  get: () => library.value.startup,
  set: (value: Startup) => void act({ type: "set-startup", startup: value }),
});
const sort = computed({
  get: () => library.value.sort,
  set: (value: RootSort) => void act({ type: "set-sort", sort: value }),
});

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
        <div v-for="group in GROUPS" :key="group.label" class="flex flex-col gap-0.5">
          <h3 class="text-muted-foreground px-3 pb-1 text-xs font-medium">{{ group.label }}</h3>
          <button
            v-for="item in group.sections"
            :key="item.id"
            type="button"
            :class="
              cn(
                'text-muted-foreground hover:bg-accent hover:text-foreground flex h-9 items-center gap-3 rounded-lg px-3 text-left font-medium',
                section === item.id && 'bg-accent text-foreground',
              )
            "
            :data-testid="`settings-nav-${item.id}`"
            :aria-current="section === item.id ? 'page' : undefined"
            @click="section = item.id"
          >
            <component :is="item.icon" class="size-4 flex-none" :stroke-width="1.5" />
            <span class="flex-1">{{ item.label }}</span>
            <span v-if="item.id === 'trash' && library.trash.length" class="text-muted-foreground text-xs tabular-nums">{{ library.trash.length }}</span>
          </button>
        </div>
      </nav>

      <div class="relative min-w-0 flex-1 overflow-y-auto">
        <DialogClose as-child>
          <Button variant="ghost" size="icon" class="absolute top-4 right-4" data-testid="settings-close" aria-label="Close settings" title="Close">
            <X :stroke-width="1.5" />
          </Button>
        </DialogClose>

        <div class="max-w-[760px] px-10 py-10">
          <template v-if="section === 'general'">
            <h2 class="mb-4 text-xl font-semibold">General</h2>
            <SettingRow label="When Tavora starts" description="Show Home, or go straight back to the game you played last.">
              <SegmentedControl
                v-model="startup"
                label="When Tavora starts"
                :options="[
                  { value: 'welcome', label: 'Home', testid: 'startup-welcome' },
                  { value: 'last-game', label: 'Last game', testid: 'startup-last-game' },
                ]"
              />
            </SettingRow>
            <SettingRow label="Game list order" description="How games are sorted on the rail. In your own order, drag games to arrange them.">
              <SegmentedControl
                v-model="sort"
                label="Game list order"
                :options="[
                  { value: 'recent', label: 'Recently played', testid: 'sort-recent' },
                  { value: 'manual', label: 'My own order', testid: 'sort-manual' },
                ]"
              />
            </SettingRow>
          </template>

          <template v-else-if="section === 'trash'">
            <h2 class="text-xl font-semibold">Trash</h2>
            <p class="text-muted-foreground mt-2 mb-4">Removed games and all their data stay here for 30 days, then they are deleted for good.</p>
            <div class="border-t" data-testid="trash">
              <p v-if="!library.trash.length" class="text-muted-foreground py-4" data-testid="trash-empty">Trash is empty.</p>
              <ul v-else>
                <li
                  v-for="entry in library.trash"
                  :key="entry.game.id"
                  class="flex min-h-16 items-center gap-4 border-b py-3 last:border-b-0"
                  :data-testid="`trash-${entry.game.id}`"
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
      </div>
    </DialogContent>
  </Dialog>
</template>
