<script setup lang="ts">
// The modules a workspace's empty page offers, one click each: in a game workspace the catalog's modules made for the
// game first (an installed one opens, another installs, then opens), then Browser, Notes and To-Dos, at most
// MAX_TILES; the last tile opens the library ("+3 more for <game>" when the game has more than fit). A game the catalog
// has none for offers Ask for a module, one anonymous vote. Offline, or with online features off, only the built-in ones show.
import { computed, ref, watch } from "vue";
import type { CatalogModuleView, WorkspaceView } from "../../../shared/host-api";
import { askKey, type AskedGame } from "../../../shared/module-request";
import { ActionTile } from "@tavora/official-ui/components/ui/action-tile";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Notice } from "@tavora/official-ui/components/ui/notice";
import { Skeleton } from "@tavora/official-ui/components/ui/skeleton";
import { useTask } from "@tavora/official-ui/use-task";
import { useActionStatus } from "../../action-status";
import { act, addModule, api, dialog, installProgress, openPanels, state } from "../../host";
import { t } from "../../i18n";
import { madeForWorkspace } from "../../lib/game-picker";
import CatalogIcon from "../CatalogIcon.vue";
import ModuleIcon from "../ModuleIcon.vue";

const props = defineProps<{ workspace: WorkspaceView }>();

/** Tiles before the last one, which opens the library. */
const MAX_TILES = 9;
/** Tavora's own modules every workspace is offered, in this order, when they are there. */
const GENERAL = ["tavora.browser", "tavora.notes", "tavora.todos"];

const isGame = computed(() => props.workspace.kind === "game");

/** The catalog's modules made for this game, or null while they load (`loader` busy) and when the catalog can't be asked. */
const made = ref<CatalogModuleView[] | null>(null);
const loader = useTask({ mode: "latest" });
watch(
  () => [props.workspace.id, isGame.value] as const,
  async ([workspaceId, game]) => {
    made.value = null;
    if (!game) return;
    const listed = await loader.run(() => api.browseCatalog({ workspaceId }));
    if (listed?.status === "ok") made.value = madeForWorkspace(listed.modules);
  },
  { immediate: true },
);

const installed = (id: string) => state.value?.modules.some((module) => module.id === id && module.available) ?? false;
const general = computed(() => GENERAL.filter(installed));
const gameShown = computed(() => (made.value ?? []).slice(0, Math.max(0, MAX_TILES - general.value.length)));
const more = computed(() => (made.value?.length ?? 0) - gameShown.value.length);

// ── Adding one ─────────────────────────────────────────────────────────

const { statusOf, run, working } = useActionStatus();
const errors = ref<Record<string, string>>({});

/** An installed one opens; one from the catalog installs first. */
async function addGameModule(module: CatalogModuleView) {
  if (installed(module.id)) return addModule(module.id);
  const { [module.id]: _, ...rest } = errors.value;
  errors.value = rest;
  await run(module.id, async () => {
    const outcome = await act({ type: "install-catalog-module", moduleId: module.id }, { quiet: true });
    if (!outcome.ok) {
      errors.value = { ...errors.value, [module.id]: outcome.error };
      return false;
    }
    await openPanels(module.id, null, []);
    return true;
  });
}

function openLibrary() {
  dialog.value = more.value > 0 ? { kind: "add-module", view: "catalog" } : { kind: "add-module" };
}

const moduleName = (id: string) => state.value?.modules.find((module) => module.id === id)?.name ?? id;
const failed = computed(() => (made.value ?? []).filter((module) => errors.value[module.id]));

// ── None made yet ──────────────────────────────────────────────────────

/** The game as Ask for a module names it: its Steam app id and Tavora's id (a game added by name has none). */
const askedGame = computed<AskedGame>(() => ({
  name: props.workspace.name,
  steamAppId: props.workspace.steamAppId,
  gameId: props.workspace.id.startsWith("local-") ? null : props.workspace.id,
}));
const asked = computed(() => (state.value?.library.askedModules ?? []).includes(askKey(askedGame.value)));
/** One anonymous vote; a failure says so and the link stays. */
const asker = useTask({ describe: () => t("error.generic") });

async function ask() {
  const result = await asker.run(() => act({ type: "ask-module", ...askedGame.value }, { quiet: true }));
  if (result && !result.ok) asker.fail(result.error);
}
</script>

<template>
  <section class="flex w-full flex-col items-center gap-2" :aria-labelledby="`start-modules-${workspace.id}`" data-testid="start-modules">
    <p :id="`start-modules-${workspace.id}`" class="text-sm font-semibold">{{ t("workspace.addModule") }}</p>
    <div class="flex max-w-124 flex-wrap justify-center gap-2">
      <!-- While the catalog is asked: one made-up tile where the game's own will be. -->
      <Skeleton v-if="loader.busy.value" :loading="true" data-testid="made-for-loading">
        <ActionTile label="A module" featured tabindex="-1"><template #icon><span class="bg-muted block size-9 rounded-md" /></template></ActionTile>
      </Skeleton>
      <ActionTile
        v-for="module in gameShown"
        :key="module.id"
        featured
        :label="module.name"
        :status="statusOf(module.id)"
        :progress="installProgress[module.id] ?? null"
        :busy-label="t('catalog.installing')"
        :done-label="t('catalog.installed')"
        :failed-label="t('catalog.installFailed')"
        :disabled="working && statusOf(module.id) === 'idle'"
        :disabled-reason="t('workspace.madeForWait')"
        :title="module.description ?? undefined"
        :aria-label="t('addModule.addLabel', { name: module.name })"
        :data-testid="`made-for-add-${module.id}`"
        @click="addGameModule(module)"
      >
        <template #icon><CatalogIcon :module-id="module.id" :has="module.icon" size="size-9" /></template>
      </ActionTile>
      <ActionTile
        v-for="id in general"
        :key="id"
        :label="moduleName(id)"
        :aria-label="t('addModule.addLabel', { name: moduleName(id) })"
        :data-testid="`start-add-${id}`"
        @click="addModule(id)"
      >
        <template #icon><ModuleIcon :module-id="id" size="size-9" /></template>
      </ActionTile>
      <ActionTile
        kind="more"
        :label="more > 0 ? t('workspace.moreForGame', { count: more, game: workspace.name }) : t('workspace.allModules')"
        aria-haspopup="dialog"
        data-testid="empty-add-module"
        @click="openLibrary"
      />
    </div>
    <Notice v-for="module in failed" :key="module.id" variant="error" class="w-full max-w-124" :data-testid="`made-for-error-${module.id}`">{{ errors[module.id] }}</Notice>
    <template v-if="isGame && made && !made.length">
      <p v-if="asked" class="text-muted-foreground text-xs" role="status" data-testid="ask-module-thanks">{{ t("workspace.askThanks") }}</p>
      <template v-else>
        <Button variant="link" size="sm" class="text-muted-foreground h-auto py-0 text-xs" :disabled="asker.busy.value" data-testid="ask-module" @click="ask">{{
          t("workspace.askModule", { game: workspace.name })
        }}</Button>
        <Notice v-if="asker.error.value" variant="error" class="w-full max-w-124" data-testid="ask-module-error">{{ asker.error.value }}</Notice>
      </template>
    </template>
  </section>
</template>
