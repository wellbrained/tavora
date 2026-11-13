<script setup lang="ts">
// On a game workspace's empty page: the catalog's modules made for this game that aren't installed yet, one click to
// add each (it installs, then its panel opens). When the catalog has none for the game, Ask for a module sends one
// anonymous vote for it. Offline, or with online features off, nothing shows.
import { Puzzle } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import type { CatalogModuleView, WorkspaceView } from "../../../shared/host-api";
import { askKey, type AskedGame } from "../../../shared/module-request";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Notice } from "@tavora/official-ui/components/ui/notice";
import { ProgressButton } from "@tavora/official-ui/components/ui/progress-button";
import { Skeleton } from "@tavora/official-ui/components/ui/skeleton";
import { useTask } from "@tavora/official-ui/use-task";
import { useActionStatus } from "../../action-status";
import { act, api, installProgress, openPanels, state } from "../../host";
import { t } from "../../i18n";
import { madeForWorkspace } from "../../lib/game-picker";
import CatalogIcon from "../CatalogIcon.vue";

const props = defineProps<{ workspace: WorkspaceView }>();

/** The catalog's modules made for this game, or null while they load (`loader` busy) and when the catalog can't be asked. */
const made = ref<CatalogModuleView[] | null>(null);
const loader = useTask({ mode: "latest" });
watch(
  () => props.workspace.id,
  async (workspaceId) => {
    made.value = null;
    const listed = await loader.run(() => api.browseCatalog({ workspaceId }));
    if (listed?.status === "ok") made.value = madeForWorkspace(listed.modules);
  },
  { immediate: true },
);
const toAdd = computed(() => (made.value ?? []).filter((module) => !state.value?.modules.some((installed) => installed.id === module.id)));

// ── Adding one ─────────────────────────────────────────────────────────

const { statusOf, run, working } = useActionStatus();
const errors = ref<Record<string, string>>({});

async function add(module: CatalogModuleView) {
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

// ── None made yet ──────────────────────────────────────────────────────

/** The game as Ask for a module names it: its Steam app id and Tavora's id (a game added by name has none). */
const askedGame = computed<AskedGame>(() => ({
  name: props.workspace.name,
  steamAppId: props.workspace.steamAppId,
  gameId: props.workspace.id.startsWith("local-") ? null : props.workspace.id,
}));
const asked = computed(() => (state.value?.library.askedModules ?? []).includes(askKey(askedGame.value)));
/** One anonymous vote; a failure says so and the button stays. */
const asker = useTask({ describe: () => t("error.generic") });

async function ask() {
  const result = await asker.run(() => act({ type: "ask-module", ...askedGame.value }, { quiet: true }));
  if (result && !result.ok) asker.fail(result.error);
}
</script>

<template>
  <section v-if="loader.busy.value || (made && (toAdd.length || !made.length))" class="flex w-full max-w-sm flex-col gap-2 text-left" :aria-label="t('workspace.madeFor', { game: workspace.name })" data-testid="made-for-game">
    <p class="text-muted-foreground truncate text-xs font-medium" aria-hidden="true">{{ t("workspace.madeFor", { game: workspace.name }) }}</p>
    <!-- While the catalog is asked: one made-up module, so the page below doesn't move when the answer comes. -->
    <Skeleton v-if="!made" :loading="true" data-testid="made-for-loading">
      <div class="bg-card flex items-center gap-3 rounded-lg border p-2">
        <Puzzle class="size-8 flex-none" />
        <span class="min-w-0 flex-1">
          <span class="block truncate text-sm font-medium">A module</span>
          <span class="text-muted-foreground block truncate text-xs">What it does for the game</span>
        </span>
        <Button size="sm" variant="outline">{{ t("common.add") }}</Button>
      </div>
    </Skeleton>
    <ul v-else-if="toAdd.length" class="m-0 flex list-none flex-col gap-1.5 p-0">
      <li v-for="module in toAdd" :key="module.id" class="bg-card flex flex-col gap-2 rounded-lg border p-2" :data-testid="`made-for-${module.id}`">
        <div class="flex items-center gap-3">
          <CatalogIcon :module-id="module.id" :has="module.icon" size="size-8" />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-medium">{{ module.name }}</span>
            <span v-if="module.description" class="text-muted-foreground block truncate text-xs">{{ module.description }}</span>
          </span>
          <ProgressButton
            size="sm"
            variant="outline"
            :status="statusOf(module.id)"
            :progress="installProgress[module.id] ?? null"
            :busy-label="t('catalog.installing')"
            :done-label="t('catalog.installed')"
            :failed-label="t('catalog.installFailed')"
            :disabled="working && statusOf(module.id) === 'idle'"
            :disabled-reason="t('workspace.madeForWait')"
            :aria-label="t('addModule.addLabel', { name: module.name })"
            :data-testid="`made-for-add-${module.id}`"
            @click="add(module)"
            >{{ t("common.add") }}</ProgressButton
          >
        </div>
        <Notice v-if="errors[module.id]" variant="error" :data-testid="`made-for-error-${module.id}`">{{ errors[module.id] }}</Notice>
      </li>
    </ul>
    <div v-else class="flex flex-col items-start gap-2" data-testid="no-modules-yet">
      <p class="text-muted-foreground text-sm">{{ t("workspace.noModulesYet", { game: workspace.name }) }}</p>
      <p v-if="asked" class="text-muted-foreground text-sm" role="status" data-testid="ask-module-thanks">{{ t("workspace.askThanks") }}</p>
      <template v-else>
        <Button variant="outline" size="sm" :disabled="asker.busy.value" data-testid="ask-module" @click="ask">{{ t("workspace.askModule", { game: workspace.name }) }}</Button>
        <Notice v-if="asker.error.value" variant="error" class="w-full" data-testid="ask-module-error">{{ asker.error.value }}</Notice>
      </template>
    </div>
  </section>
</template>
