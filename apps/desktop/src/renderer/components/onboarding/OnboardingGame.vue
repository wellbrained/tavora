<script setup lang="ts">
// Screen 3, game pick: a game search (arrow keys move, Enter adds the highlighted game, the top match at first),
// a few popular games as one-click chips, and, once a game is added, an optional offer to set up the catalog
// modules made for it. Adding a game is the same add-workspace the Add game dialog uses and installing a module
// the same install-catalog-module as the library's Browse; nothing opens until the welcome ends.
import { ArrowLeft, Check, Search } from "@lucide/vue";
import { computed, onMounted, ref, watch } from "vue";
import type { CatalogMatch, CatalogModuleView, OnlineGame } from "../../../shared/host-api";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Checkbox } from "@tavora/official-ui/components/ui/checkbox";
import { Input } from "@tavora/official-ui/components/ui/input";
import { Kbd } from "@tavora/official-ui/components/ui/kbd";
import { useGameSearch, type GameRow } from "@/lib/game-search";
import { useListNav } from "@/lib/list-nav";
import { cn } from "@/lib/utils";
import { act, api, listOf, state } from "../../host";
import { t } from "../../i18n";
import CatalogIcon from "../CatalogIcon.vue";

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
const name = computed(() => query.value.replace(/\s+/g, " ").trim());
const { rows, onlineStatus, addInput } = useGameSearch(query);
const error = ref<string | null>(null);
const busy = ref(false);

// Popular games, one click each; the ones the user has are left out.
const popular = ref<CatalogMatch[]>([]);
onMounted(async () => (popular.value = await api.popularGames()));
const chips = computed(() => popular.value.filter((game) => !state.value!.library.workspaces[game.id]).slice(0, 6));

const list = ref<HTMLElement | null>(null);
const { active, onKey } = useListNav({ count: () => rows.value.length, list, onEnter: submit });
// The top match is highlighted again whenever the results change.
watch(
  () => rows.value.map((row) => row.id).join("\n"),
  () => (active.value = 0),
);
const optionId = (row: GameRow) => `onboarding-option-${row.id}`;
const activeId = computed(() => {
  const row = rows.value[active.value];
  return row ? optionId(row) : undefined;
});

/** What is shown under the game: the search, the offer of its modules (loading, or the list), or "ready". */
const phase = ref<"pick" | "offer" | "ready">(props.started ? "ready" : "pick");
const offer = ref<CatalogModuleView[] | null>(null);
const ticked = ref<Set<string>>(new Set());
const installing = ref(false);
const failed = ref<Record<string, string>>({});
const game = ref<StartedGame | null>(props.started);

async function add(input: { catalogId: string } | { online: OnlineGame } | { name: string }, label: string) {
  if (busy.value) return;
  busy.value = true;
  error.value = null;
  const result = props.dry ? { ok: true as const, id: pretendId(input, label) } : await act({ type: "add-workspace", ...input }, { quiet: true });
  busy.value = false;
  if (!result.ok || !result.id) {
    if (!result.ok) error.value = result.error;
    return;
  }
  const workspace = props.dry ? undefined : state.value!.library.workspaces[result.id];
  game.value = { id: result.id, name: workspace?.name ?? label, moduleIds: [] };
  emit("start", game.value);
  phase.value = "offer";
  offer.value = null;
  // The catalog's modules for this game (offline or switched off: none, and the offer is skipped).
  const listed = await api.browseCatalog(props.dry ? { game: result.id } : { workspaceId: result.id });
  const made = listed.status === "ok" ? listed.modules.filter((module) => module.fits && module.forGames.length > 0).slice(0, 4) : [];
  if (!made.length) {
    phase.value = "ready";
    return;
  }
  offer.value = made;
  ticked.value = new Set(made.map((module) => module.id));
}

/** The id a game would get in a dry run: its catalog id, else its name as a slug. */
function pretendId(input: { catalogId: string } | { online: OnlineGame } | { name: string }, label: string): string {
  if ("catalogId" in input) return input.catalogId;
  if ("online" in input) return input.online.id;
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function submit() {
  const row = rows.value[active.value];
  if (row) void add(addInput(row), row.name);
  else if (name.value) void add({ name: name.value }, name.value);
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
  installing.value = true;
  failed.value = {};
  const done: string[] = [];
  for (const module of offer.value.filter((item) => ticked.value.has(item.id))) {
    if (state.value!.modules.some((installed) => installed.id === module.id)) {
      done.push(module.id);
      continue;
    }
    const result = props.dry ? { ok: true as const } : await act({ type: "install-catalog-module", moduleId: module.id }, { quiet: true });
    if (result.ok) done.push(module.id);
    else failed.value = { ...failed.value, [module.id]: result.error };
  }
  installing.value = false;
  game.value = { ...game.value, moduleIds: done };
  emit("start", game.value);
  if (!Object.keys(failed.value).length) phase.value = "ready";
}

function notNow() {
  phase.value = "ready";
}
</script>

<template>
  <section class="flex w-full max-w-[560px] flex-col items-center text-center" data-testid="onboarding-game">
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

      <ul
        id="onboarding-results"
        ref="list"
        role="listbox"
        class="mt-2 max-h-52 w-full overflow-y-auto text-left [@media(max-height:640px)]:max-h-28"
        :aria-label="t('common.games')"
      >
        <li v-for="(row, index) in rows" :id="optionId(row)" :key="row.id" role="option" :aria-selected="index === active">
          <button
            type="button"
            tabindex="-1"
            :class="cn('flex w-full items-center gap-2 rounded-md px-2 py-2 text-left', index === active && 'bg-accent')"
            :disabled="busy"
            :data-testid="`onboarding-game-${row.id}`"
            @mousemove="active = index"
            @click="add(addInput(row), row.name)"
          >
            <span class="min-w-0 flex-1 truncate">{{ row.name }}</span>
            <Kbd v-if="index === active" class="font-sans" aria-hidden="true">{{ t("search.key.enter") }}</Kbd>
          </button>
        </li>
        <li v-if="name">
          <button type="button" tabindex="-1" class="text-primary hover:bg-accent w-full rounded-md px-2 py-2 text-left" :disabled="busy" data-testid="onboarding-custom" @click="add({ name }, name)">
            {{ t("addGame.custom", { name }) }}
          </button>
        </li>
      </ul>
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
