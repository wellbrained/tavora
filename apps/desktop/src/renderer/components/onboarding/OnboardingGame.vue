<script setup lang="ts">
// Screen 3, game pick: the games on this PC, most recently played first, and a search (the same list as the Add a game
// dialog: arrow keys move, Enter or a click adds that game, the top match at first), a few popular games as
// one-click chips when no games are found on this PC, and, once a game is added, an optional offer to set up the catalog
// modules made for it. Adding a game is the same add-workspace the Add game dialog uses and installing a module
// the same install-catalog-module as the library's Browse; nothing opens until the welcome ends.
import { ArrowLeft, Check, Search } from "@lucide/vue";
import { computed, onMounted, ref } from "vue";
import type { CatalogMatch, CatalogModuleView } from "../../../shared/host-api";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Checkbox } from "@tavora/official-ui/components/ui/checkbox";
import { Input } from "@tavora/official-ui/components/ui/input";
import { useTask } from "@tavora/official-ui/use-task";
import type { AddInput } from "../../lib/game-picker";
import { useGamePicker } from "../../lib/use-game-picker";
import { act, api, listOf, state } from "../../host";
import { t } from "../../i18n";
import CatalogIcon from "../CatalogIcon.vue";
import GamePickerList from "../GamePickerList.vue";

/** The game added here, and the modules to open in it once the welcome ends. */
export interface StartedGame {
  id: string;
  name: string;
  moduleIds: string[];
}

/** `dry`: the welcome is only tried (dev build): nothing is added or installed, it is pretended. */
const props = defineProps<{ started: StartedGame | null; dry?: boolean }>();
const emit = defineEmits<{ start: [StartedGame]; next: []; back: [] }>();

const query = ref("");
const list = ref<HTMLElement | null>(null);
// Games the user already has are left out.
const picker = useGamePicker(query, { hideAdded: true, listId: "onboarding-results", list, onEnter: (key) => pick(key) });
const { name, lines, custom, installed, installedLoaded, onlineStatus, info, active, activeId, onKey } = picker;
/** Adding the game: it always ends (a throw shows as an error), so the list is usable again. */
const adder = useTask({ describe: () => t("error.generic") });
const busy = adder.busy;
/** The item picked last, by key: while adding it shows the spinner. */
const picked = ref<string | null>(null);
/** The host's own answer when it did not go through; a request that threw is the task's error. */
const answered = ref<string | null>(null);
const error = computed(() => answered.value ?? adder.error.value);

// Popular games, one click each; the ones the user has are left out.
const popular = ref<CatalogMatch[]>([]);
onMounted(async () => (popular.value = await api.popularGames()));
// Only when no games were found on this PC; otherwise the list of the games the user plays is the better start.
const chips = computed(() => (installedLoaded.value && !installed.value.length ? popular.value.filter((game) => !state.value!.library.workspaces[game.id]).slice(0, 6) : []));

/** What is shown under the game: the search, the offer of its modules (loading, or the list), or "ready". */
const phase = ref<"pick" | "offer" | "ready">(props.started ? "ready" : "pick");
const offer = ref<CatalogModuleView[] | null>(null);
const ticked = ref<Set<string>>(new Set());
/** Installing the offered modules: it always ends, so the buttons are usable again. */
const installer = useTask({ describe: () => t("error.generic") });
const installing = installer.busy;
const failed = ref<Record<string, string>>({});
const game = ref<StartedGame | null>(props.started);

/** Adds a game: its input, or (a pick from the list) what resolves to it. */
async function add(input: AddInput | (() => Promise<AddInput>), label: string, key: string | null = null) {
  if (busy.value) return;
  picked.value = key;
  answered.value = null;
  const result = await adder.run(async () => {
    const resolved = typeof input === "function" ? await input() : input;
    return props.dry ? { ok: true as const, id: pretendId(resolved, label) } : await act({ type: "add-workspace", ...resolved }, { quiet: true });
  });
  if (!result) return;
  if (!result.ok || !result.id) {
    if (!result.ok) answered.value = result.error;
    return;
  }
  const workspace = props.dry ? undefined : state.value!.library.workspaces[result.id];
  game.value = { id: result.id, name: workspace?.name ?? label, moduleIds: [] };
  emit("start", game.value);
  phase.value = "offer";
  offer.value = null;
  // The catalog's modules for this game (offline or switched off: none, and the offer is skipped).
  const listed = await api.browseCatalog(props.dry ? { game: result.id } : { workspaceId: result.id }).catch(() => null);
  const made = listed?.status === "ok" ? listed.modules.filter((module) => module.fits && module.forGames.length > 0).slice(0, 4) : [];
  if (!made.length) {
    phase.value = "ready";
    return;
  }
  offer.value = made;
  ticked.value = new Set(made.map((module) => module.id));
}

/** The id a game would get in a dry run: its catalog id, else its name as a slug. */
function pretendId(input: AddInput, label: string): string {
  if ("catalogId" in input) return input.catalogId;
  if ("online" in input) return input.online.id;
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/** Enter, or a click: adds the game picked, by its key (or the typed name). */
function pick(key: string) {
  const game = picker.target(key);
  if (!game) return;
  active.value = key;
  void add(async () => (await picker.addInput(game)).input, game.name, key);
}

function toggle(id: string, on: boolean | "indeterminate") {
  const next = new Set(ticked.value);
  if (on === true) next.add(id);
  else next.delete(id);
  ticked.value = next;
}

/** Installs the ticked modules, one after another; the ones that fail keep their error and stay out. */
async function setUp() {
  if (installing.value || !offer.value || !game.value) return;
  failed.value = {};
  const done: string[] = [];
  const chosen = offer.value.filter((item) => ticked.value.has(item.id));
  const ran = await installer.run(async () => {
    for (const module of chosen) {
      if (state.value!.modules.some((installed) => installed.id === module.id)) {
        done.push(module.id);
        continue;
      }
      try {
        const result = props.dry ? { ok: true as const } : await act({ type: "install-catalog-module", moduleId: module.id }, { quiet: true });
        if (result.ok) done.push(module.id);
        else failed.value = { ...failed.value, [module.id]: result.error };
      } catch {
        failed.value = { ...failed.value, [module.id]: t("error.generic") };
      }
    }
    return true;
  });
  if (!ran || !game.value) return;
  game.value = { ...game.value, moduleIds: done };
  emit("start", game.value);
  if (!Object.keys(failed.value).length) phase.value = "ready";
}

function notNow() {
  phase.value = "ready";
}
</script>

<template>
  <section class="flex w-full max-w-[560px] flex-col items-center text-center" data-testid="onboarding-game" :data-status="adder.state.value.status">
    <!-- Pick -->
    <template v-if="phase === 'pick'">
      <h1 class="text-3xl font-semibold">{{ t("onboarding.game.title") }}</h1>
      <p class="text-muted-foreground mt-2 mb-5 [@media(max-height:640px)]:mb-3">{{ t("onboarding.game.sub") }}</p>

      <div class="relative w-full text-left">
        <Search class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" :stroke-width="1.5" />
        <Input
          v-model="query"
          class="h-10 pl-9"
          :placeholder="t('addGame.search')"
          :aria-label="t('addGame.search')"
          autocomplete="off"
          maxlength="80"
          role="combobox"
          aria-expanded="true"
          aria-controls="onboarding-results"
          aria-autocomplete="list"
          :aria-activedescendant="activeId"
          data-testid="onboarding-search"
          autofocus
          @keydown="onKey"
        />
      </div>
      <p v-if="error" class="text-destructive mt-2 text-sm" role="alert" data-testid="onboarding-error">{{ error }}</p>

      <div ref="list" class="mt-2 max-h-52 w-full overflow-y-auto text-left [@media(max-height:640px)]:max-h-28">
        <GamePickerList
          id="onboarding-results"
          :label="t('common.games')"
          :lines="lines"
          :active="active"
          :custom="custom"
          :typed="!!name"
          :info="info"
          :adding="busy ? picked : null"
          test-prefix="onboarding-game"
          customTestid="onboarding-custom"
          @hover="active = $event"
          @pick="pick"
        />
      </div>
      <p v-if="onlineStatus === 'unreachable' && name" class="text-muted-foreground mt-1 text-xs">{{ t("addGame.builtInOnly") }}</p>

      <div v-if="chips.length && !name" class="mt-4 flex flex-col items-center gap-2">
        <span class="text-muted-foreground text-xs">{{ t("onboarding.game.popular") }}</span>
        <ul class="flex flex-wrap justify-center gap-2" data-testid="onboarding-popular">
          <li v-for="chip in chips" :key="chip.id">
            <Button variant="outline" size="sm" :disabled="busy" :data-testid="`onboarding-popular-${chip.id}`" @click="add({ catalogId: chip.id }, chip.name)">{{ chip.name }}</Button>
          </li>
        </ul>
      </div>

      <Button variant="ghost" class="mt-5" data-testid="onboarding-back" @click="$emit('back')"><ArrowLeft :stroke-width="1.5" /> {{ t("common.back") }}</Button>
    </template>

    <!-- Offer: the modules made for this game -->
    <template v-else-if="phase === 'offer'">
      <h1 class="text-3xl font-semibold">{{ t("onboarding.offer.title", { game: game?.name ?? "" }) }}</h1>
      <p v-if="!offer" class="text-muted-foreground mt-4" role="status">{{ t("onboarding.offer.loading") }}</p>
      <template v-else>
        <p class="text-muted-foreground mt-2 mb-5" data-testid="onboarding-offer-sub">{{ t("onboarding.offer.sub", { game: game?.name ?? "", names: listOf(offer.map((module) => module.name)) }) }}</p>
        <ul class="flex w-full flex-col gap-2 text-left" data-testid="onboarding-offer">
          <li v-for="module in offer" :key="module.id" class="bg-card rounded-lg border">
            <label class="flex cursor-pointer items-center gap-3 p-3">
              <Checkbox :model-value="ticked.has(module.id)" :data-testid="`onboarding-offer-${module.id}`" @update:model-value="(on: boolean | 'indeterminate') => toggle(module.id, on)" />
              <CatalogIcon :module-id="module.id" :has="module.icon" size="size-9" />
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="truncate font-medium">{{ module.name }}</span>
                <span v-if="module.description" class="text-muted-foreground truncate text-sm">{{ module.description }}</span>
                <span v-if="failed[module.id]" class="text-destructive text-sm" role="alert">{{ failed[module.id] }}</span>
              </span>
            </label>
          </li>
        </ul>
        <div class="mt-6 flex items-center gap-3">
          <Button variant="ghost" :disabled="installing" data-testid="onboarding-not-now" @click="notNow">{{ t("onboarding.notNow") }}</Button>
          <Button class="min-w-32" :disabled="installing || !ticked.size" data-testid="onboarding-setup" @click="setUp">
            {{ installing ? t("catalog.installing") : t(offer.length > 1 ? "onboarding.offer.addThem" : "onboarding.offer.addIt") }}
          </Button>
        </div>
      </template>
    </template>

    <!-- Ready -->
    <template v-else>
      <span class="bg-primary/15 text-primary mb-4 grid size-12 place-items-center rounded-full"><Check class="size-6" :stroke-width="2" /></span>
      <h1 class="text-3xl font-semibold" data-testid="onboarding-ready">{{ t("onboarding.ready.title", { game: game?.name ?? "" }) }}</h1>
      <p class="text-muted-foreground mt-2">{{ game?.moduleIds.length ? t("onboarding.ready.withModules") : t("onboarding.ready.sub") }}</p>
      <div class="mt-6 flex items-center gap-3">
        <Button variant="ghost" data-testid="onboarding-back" @click="$emit('back')"><ArrowLeft :stroke-width="1.5" /> {{ t("common.back") }}</Button>
        <Button class="min-w-32" data-testid="onboarding-next" @click="$emit('next')">{{ t("common.next") }}</Button>
      </div>
    </template>
  </section>
</template>
