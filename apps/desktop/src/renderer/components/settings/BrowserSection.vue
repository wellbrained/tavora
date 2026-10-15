<script setup lang="ts">
// Settings > Browser: the sites the player marked in a Browser panel's
// toolbar, and clearing what websites stored. Sites are only added from the
// toolbar, where the player is on the site; here they can be removed.
import { X } from "@lucide/vue";
import { computed } from "vue";
import { Button } from "@/components/ui/button";
import { act, confirmAction, state, submitAction } from "../../host";
import SettingRow from "./SettingRow.vue";

defineProps<{ highlight: string | null }>();

const browser = computed(() => state.value!.library.browser);
const game = computed(() => {
  const view = state.value!;
  return view.currentGameId ? view.library.games[view.currentGameId] : undefined;
});

const LISTS = [
  {
    id: "shared" as const,
    setting: "browser-shared-sites",
    label: "Signed in for all games",
    description: "These sites keep one sign-in for every game. Every other site keeps cookies and sign-ins for each game on its own. Add a site with the people button in a Browser panel's toolbar.",
    empty: "No sites yet.",
    sites: () => browser.value.sharedSites,
  },
  {
    id: "adblock-off" as const,
    setting: "browser-adblock-off",
    label: "Ads allowed",
    description: "Ad and tracker blocking is on everywhere except these sites. Change it with the shield button in a Browser panel's toolbar.",
    empty: "Ads are blocked on every site.",
    sites: () => browser.value.adblockOff,
  },
];

function clear(scope: "game" | "shared") {
  confirmAction({
    title: scope === "game" ? `Clear browser data for ${game.value?.name ?? "this game"}?` : "Clear shared browser data?",
    message:
      scope === "game"
        ? "Signs you out of every site in this game's Browser panels and deletes their cookies, site data and cache. Sites signed in for all games are not affected."
        : "Signs you out of every site signed in for all games and deletes their cookies, site data and cache.",
    confirm: "Clear",
    danger: true,
    run: () => submitAction({ type: "clear-browser-data", scope }),
  });
}
</script>

<template>
  <h2 class="text-xl font-semibold">Browser</h2>
  <p class="text-muted-foreground mt-2 mb-4">
    Browser panels open websites next to your game. Pages can't use your camera, location or notifications, can't open programs, and never download files.
  </p>
  <div v-for="list in LISTS" :key="list.id" class="-mx-3 rounded-lg border-b px-3 py-4 transition-colors duration-500" :class="highlight === list.setting && 'bg-primary/10'" :data-setting="list.setting">
    <div class="flex flex-col gap-1">
      <span class="font-medium">{{ list.label }}</span>
      <span class="text-muted-foreground">{{ list.description }}</span>
    </div>
    <p v-if="!list.sites().length" class="text-muted-foreground mt-3 text-sm">{{ list.empty }}</p>
    <ul v-else class="mt-3 flex flex-wrap gap-2" :data-testid="list.setting">
      <li v-for="site in list.sites()" :key="site" class="bg-secondary flex h-8 items-center gap-1 rounded-md pr-1 pl-3 text-sm">
        {{ site }}
        <Button variant="ghost" size="icon-xs" :aria-label="`Remove ${site}`" @click="act({ type: 'browser-forget-site', list: list.id, site })">
          <X :stroke-width="1.5" />
        </Button>
      </li>
    </ul>
  </div>
  <SettingRow
    label="Clear browser data for this game"
    description="Signs you out of the sites in this game's Browser panels and deletes their cookies, site data and cache."
    setting="browser-clear-game"
    :highlighted="highlight === 'browser-clear-game'"
  >
    <Button variant="secondary" :disabled="!game" data-testid="browser-clear-game" @click="clear('game')">Clear…</Button>
  </SettingRow>
  <SettingRow
    label="Clear shared browser data"
    description="Signs you out of the sites signed in for all games and deletes their cookies, site data and cache."
    setting="browser-clear-shared"
    :highlighted="highlight === 'browser-clear-shared'"
  >
    <Button variant="secondary" data-testid="browser-clear-shared" @click="clear('shared')">Clear…</Button>
  </SettingRow>
</template>
