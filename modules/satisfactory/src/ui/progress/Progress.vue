<script setup lang="ts">
// The Progress panel: what a world has delivered, bought and researched, in four
// tabs. Ticking never blocks; "needs" hints only say what the game wants first.
import { Ellipsis, Globe, Search } from "@lucide/vue";
import { errorMessage, serial } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@tavora/official-ui/components/ui/dropdown-menu";
import { Input } from "@tavora/official-ui/components/ui/input";
import { Progress } from "@tavora/official-ui/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@tavora/official-ui/components/ui/select";
import { Switch } from "@tavora/official-ui/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@tavora/official-ui/components/ui/tabs";
import { TavoraError } from "@tavora/sdk";
import { computed, onBeforeUnmount, onMounted, ref, useId } from "vue";
import type { Localized, Phase, SchematicId } from "../../contracts/data";
import type { World } from "../../contracts/plan";
import type { Stored } from "../../contracts/repository";
import { language, t } from "../../i18n";
import { alternateGroups } from "../alternates";
import { progressPlanContentId } from "../content";
import { useModule } from "../context";
import { localize } from "../names";
import { setAlternate } from "../planEdit";
import {
  alternateNeeds,
  isProgressTab,
  markAll,
  milestoneNeeds,
  nodeNeeds,
  phaseNeeds,
  schematicNames,
  setDone,
  setPhase,
  summary,
  tierGroups,
  unmarkAll,
  type ProgressKind,
  type ProgressTab,
} from "../progress";
import ProgressRow from "./ProgressRow.vue";

interface PanelState {
  worldId?: string;
  tab?: ProgressTab;
  hideDone?: boolean;
  tree?: string;
}

const context = useModule();
const { sdk } = context;
const { data, repository } = context.services;
const hideDoneId = useId();

const worlds = ref<Stored<World>[]>([]);
const worldId = ref<string | null>(null);
const tab = ref<ProgressTab>("milestones");
const hideDone = ref(false);
const tree = ref(data.progress.research[0]?.id ?? "");
const altQuery = ref("");
const ready = ref(false);

const stored = computed(() => worlds.value.find((entry) => entry.id === worldId.value) ?? worlds.value[0] ?? null);
const world = computed(() => stored.value?.value ?? null);
const names = schematicNames(data);
const nameOf = (id: SchematicId) => localize(names.get(id) ?? { en: id }, language.value);
const local = (text: Localized) => localize(text, language.value);

const totals = computed(() => (world.value ? summary(data, world.value) : { tier: 0, done: 0, total: 0 }));
const done = computed(() => new Set(world.value ? [...world.value.milestonesDone, ...world.value.researchDone] : []));
const delivered = computed(() => new Set(world.value?.phasesDelivered ?? []));
const alternates = computed(() => new Set(world.value?.unlockedAlternates ?? []));

// ── Saving ───────────────────────────────────────────────────────────

const isConflict = (error: unknown) => (error instanceof TavoraError || error instanceof Error) && (error as { code?: unknown }).code === "CONFLICT";
const run = serial();

/** Changes the world; when another panel changed it first, the change is made again on the newest version. */
function update(change: (current: World) => World): Promise<void> {
  const id = stored.value?.id;
  if (!id) return Promise.resolve();
  return run(async () => {
    let current = worlds.value.find((entry) => entry.id === id) ?? (await repository.getWorld(id));
    for (let attempt = 1; current; attempt++) {
      try {
        const saved = await repository.putWorld(change(current.value), { id, ifRevision: current.revision });
        worlds.value = worlds.value.map((entry) => (entry.id === id ? saved : entry));
        return;
      } catch (error) {
        if (!isConflict(error) || attempt >= 5) throw error;
        current = await repository.getWorld(id);
      }
    }
  }).catch((error) => context.notify(t("notice.saveFailed", { error: errorMessage(error) })));
}

function remember() {
  const state: Record<string, string | boolean> = { tab: tab.value, hideDone: hideDone.value, tree: tree.value };
  if (stored.value) state.worldId = stored.value.id;
  void sdk.panel.setState(state satisfies PanelState).catch(() => undefined);
}

function pickWorld(id: unknown) {
  if (typeof id === "string") (worldId.value = id), remember();
}
function pickTab(next: string | number) {
  if (isProgressTab(next)) (tab.value = next), remember();
}
function pickTree(id: unknown) {
  if (typeof id === "string") (tree.value = id), remember();
}
function setHideDone(on: boolean) {
  hideDone.value = on;
  remember();
}

const tick = (kind: ProgressKind, id: SchematicId, on: boolean) => void update((current) => setDone(current, kind, id, on));

function markAllDone(kind: ProgressKind, ids: SchematicId[]) {
  let added: SchematicId[] = [];
  void update((current) => {
    const result = markAll(current, kind, ids);
    added = result.added;
    return result.world;
  }).then(() => {
    if (!added.length) return;
    const undo = added;
    context.notify(t("progress.markedDone", { count: undo.length }), { label: t("progress.undo"), run: () => void update((current) => unmarkAll(current, kind, undo)) });
  });
}

function planThis(entry: string, name: string) {
  void sdk.panels.open("planner", { content: { id: progressPlanContentId(entry), title: name } }).catch(() => context.notify(t("notice.openFailed")));
}

// ── What each tab lists ──────────────────────────────────────────────

const show = (isDone: boolean) => !(hideDone.value && isDone);

function phaseDetail(phase: Phase, index: number): string {
  const before = index > 0 ? data.progress.phases[index - 1]!.lastTier : -1;
  if (phase.phase === 0) return t("progress.startTiers", { last: phase.lastTier });
  if (phase.lastTier <= before) return t("progress.finishes");
  return phase.lastTier === before + 1 ? t("progress.opensTier", { tier: phase.lastTier }) : t("progress.opensTiers", { first: before + 1, last: phase.lastTier });
}

const phases = computed(() =>
  data.progress.phases
    .map((phase, index) => {
      const isDone = phase.phase === 0 || delivered.value.has(phase.phase);
      const before = world.value ? phaseNeeds(data, world.value, phase) : null;
      return { phase, isDone, detail: phaseDetail(phase, index), needs: before ? [local(before.name)] : [] };
    })
    .filter((row) => show(row.isDone)),
);

const tiers = computed(() =>
  tierGroups(data)
    .map((group) => {
      const rows = group.milestones.map((milestone) => {
        const needs = world.value ? milestoneNeeds(data, world.value, milestone) : { phase: null, schematics: [] };
        return {
          milestone,
          isDone: done.value.has(milestone.id),
          needs: [...(needs.phase ? [local(needs.phase.name)] : []), ...needs.schematics.map(nameOf)],
        };
      });
      return { tier: group.tier, rows: rows.filter((row) => show(row.isDone)), doneCount: rows.filter((row) => row.isDone).length, total: rows.length, ids: group.milestones.map((m) => m.id) };
    })
    .filter((group) => group.rows.length),
);

const researchTree = computed(() => data.progress.research.find((entry) => entry.id === tree.value) ?? data.progress.research[0]);
const nodes = computed(() => {
  const current = researchTree.value;
  if (!current) return { rows: [], doneCount: 0, total: 0, ids: [] };
  const rows = current.nodes.map((node) => ({ node, isDone: done.value.has(node.id), needs: world.value ? nodeNeeds(world.value, node).map(nameOf) : [] }));
  return { rows: rows.filter((row) => show(row.isDone)), doneCount: rows.filter((row) => row.isDone).length, total: rows.length, ids: current.nodes.map((n) => n.id) };
});

const altGroups = computed(() =>
  alternateGroups(data, language.value, altQuery.value)
    .map((group) => ({
      ...group,
      rows: group.recipes
        .map(({ recipe, name }) => ({
          recipe,
          name,
          isDone: alternates.value.has(recipe.id),
          needs: world.value ? alternateNeeds(data, world.value, recipe.id).map(nameOf) : [],
        }))
        .filter((row) => show(row.isDone)),
    }))
    .filter((group) => group.rows.length),
);
const altCounts = computed(() => {
  const all = Object.values(data.recipes).filter((recipe) => recipe.alternate);
  return { done: all.filter((recipe) => alternates.value.has(recipe.id)).length, total: all.length };
});

// ── Start ────────────────────────────────────────────────────────────

const cleanup: (() => void)[] = [];
onMounted(async () => {
  try {
    await repository.ensureWorld();
    worlds.value = await repository.listWorlds();
    const state = await sdk.panel.getState<PanelState>().catch(() => null);
    if (state?.worldId && worlds.value.some((entry) => entry.id === state.worldId)) worldId.value = state.worldId;
    if (isProgressTab(state?.tab)) tab.value = state.tab;
    hideDone.value = state?.hideDone === true;
    if (state?.tree && data.progress.research.some((entry) => entry.id === state.tree)) tree.value = state.tree;
    cleanup.push(
      repository.onChange(async (change) => {
        if (change.kind === "world") worlds.value = await repository.listWorlds();
      }),
    );
  } catch (error) {
    context.notify(errorMessage(error));
  } finally {
    ready.value = true;
  }
});
onBeforeUnmount(() => cleanup.forEach((fn) => fn()));
</script>

<template>
  <div class="@container relative flex h-full min-h-0 flex-col" data-testid="progress">
    <header class="border-primary/25 bg-primary/5 flex flex-none flex-wrap items-center gap-x-3 gap-y-2 border-b px-2 py-1.5" data-testid="progress-toolbar">
      <Select v-if="worlds.length" :model-value="stored?.id" @update:model-value="pickWorld">
        <SelectTrigger size="sm" class="max-w-44 min-w-0" :aria-label="t('planner.world')" :title="t('planner.world')" data-testid="progress-world">
          <Globe class="size-4" :stroke-width="1.5" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="entry in worlds" :key="entry.id" :value="entry.id">{{ entry.value.name }}</SelectItem>
        </SelectContent>
      </Select>
      <div class="flex min-w-40 flex-1 items-center gap-2" data-testid="progress-summary">
        <span class="text-sm whitespace-nowrap tabular-nums">{{ t("progress.summary", { tier: totals.tier, done: totals.done, total: totals.total }) }}</span>
        <Progress class="hidden h-1.5 max-w-32 min-w-12 flex-1 @xl:block" :model-value="totals.total ? (100 * totals.done) / totals.total : 0" :aria-label="t('progress.milestonesDone')" />
      </div>
      <div class="flex items-center gap-2">
        <Switch :id="hideDoneId" :model-value="hideDone" data-testid="progress-hide-done" @update:model-value="setHideDone" />
        <label :for="hideDoneId" class="text-sm whitespace-nowrap">{{ t("progress.hideDone") }}</label>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="ghost" size="icon-sm" :aria-label="t('planner.more')" :title="t('planner.more')" data-testid="progress-menu">
            <Ellipsis :stroke-width="1.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuCheckboxItem
            :model-value="world?.planWithUnlocks ?? false"
            :disabled="!world"
            data-testid="progress-plan-unlocked"
            @update:model-value="(on: boolean) => update((current) => ({ ...current, planWithUnlocks: on }))"
          >
            {{ t("alt.planUnlocked") }}
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>

    <p v-if="!ready" class="text-muted-foreground p-4 text-sm">{{ t("loading") }}</p>
    <Tabs v-else-if="world" as-child :model-value="tab" @update:model-value="pickTab">
      <div class="flex min-h-0 flex-1 flex-col">
        <TabsList class="mx-2 mt-2 flex-none self-start" :aria-label="t('progress.areas')">
          <TabsTrigger value="elevator" data-testid="tab-elevator">{{ t("progress.elevator") }}</TabsTrigger>
          <TabsTrigger value="milestones" data-testid="tab-milestones">{{ t("progress.milestones") }}</TabsTrigger>
          <TabsTrigger value="research" data-testid="tab-research">{{ t("progress.research") }}</TabsTrigger>
          <TabsTrigger value="alternates" data-testid="tab-alternates">{{ t("progress.alternates") }}</TabsTrigger>
        </TabsList>

        <TabsContent value="elevator" class="min-h-0 flex-1 overflow-y-auto p-2" data-testid="progress-elevator">
          <ul class="bg-card rounded-lg border" role="list">
            <ProgressRow
              v-for="row in phases"
              :key="row.phase.phase"
              :label="t('progress.phase', { phase: row.phase.phase, name: local(row.phase.name) })"
              :done="row.isDone"
              :checkable="row.phase.phase > 0"
              :cost="row.phase.cost"
              :detail="row.detail"
              :needs="row.needs"
              :can-plan="row.phase.cost.length > 0"
              testid="progress-phase"
              @toggle="(on) => update((current) => setPhase(current, row.phase.phase, on))"
              @plan="planThis(`phase-${row.phase.phase}`, local(row.phase.name))"
            />
          </ul>
          <p v-if="!phases.length" class="text-muted-foreground py-6 text-center text-sm">{{ t("progress.allDone") }}</p>
        </TabsContent>

        <TabsContent value="milestones" class="min-h-0 flex-1 overflow-y-auto p-2" data-testid="progress-milestones">
          <section v-for="group in tiers" :key="group.tier" class="mb-3" data-testid="progress-tier">
            <div class="flex items-center gap-2 px-1 pb-1">
              <h3 class="min-w-0 flex-1 text-sm font-semibold">{{ group.tier === 0 ? t("progress.hubUpgrades") : t("progress.tier", { tier: group.tier }) }}</h3>
              <span class="text-muted-foreground text-xs tabular-nums">{{ t("progress.count", { done: group.doneCount, total: group.total }) }}</span>
              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <Button variant="ghost" size="icon-xs" :aria-label="t('progress.tierMenu', { tier: group.tier })" data-testid="tier-menu">
                    <Ellipsis :stroke-width="1.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem :disabled="group.doneCount === group.total" data-testid="mark-all" @select="markAllDone('milestone', group.ids)">{{ t("progress.markAllDone") }}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <ul class="bg-card rounded-lg border" role="list">
              <ProgressRow
                v-for="row in group.rows"
                :key="row.milestone.id"
                :label="local(row.milestone.name)"
                :done="row.isDone"
                :cost="row.milestone.cost"
                :unlocks="row.milestone.unlocks"
                :needs="row.needs"
                :can-plan="row.milestone.cost.length > 0"
                testid="progress-milestone"
                @toggle="(on) => tick('milestone', row.milestone.id, on)"
                @plan="planThis(row.milestone.id, local(row.milestone.name))"
              />
            </ul>
          </section>
          <p v-if="!tiers.length" class="text-muted-foreground py-6 text-center text-sm">{{ t("progress.allDone") }}</p>
        </TabsContent>

        <TabsContent value="research" class="min-h-0 flex-1 overflow-y-auto p-2" data-testid="progress-research">
          <div class="flex flex-wrap items-center gap-2 px-1 pb-2">
            <Select :model-value="researchTree?.id" @update:model-value="pickTree">
              <SelectTrigger size="sm" class="max-w-56 min-w-0" :aria-label="t('progress.tree')" data-testid="progress-tree">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="entry in data.progress.research" :key="entry.id" :value="entry.id">{{ local(entry.name) }}</SelectItem>
              </SelectContent>
            </Select>
            <span class="text-muted-foreground flex-1 text-xs tabular-nums">{{ t("progress.count", { done: nodes.doneCount, total: nodes.total }) }}</span>
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button variant="ghost" size="icon-xs" :aria-label="t('progress.treeMenu')" data-testid="tree-menu">
                  <Ellipsis :stroke-width="1.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem :disabled="nodes.doneCount === nodes.total" data-testid="mark-all-tree" @select="markAllDone('research', nodes.ids)">{{ t("progress.markAllDone") }}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <ul v-if="nodes.rows.length" class="bg-card rounded-lg border" role="list">
            <ProgressRow
              v-for="row in nodes.rows"
              :key="row.node.id"
              :label="local(row.node.name)"
              :done="row.isDone"
              :cost="row.node.cost"
              :hard-drives="row.node.hardDrives"
              :unlocks="row.node.unlocks"
              :needs="row.needs"
              :can-plan="row.node.cost.length > 0"
              testid="progress-node"
              @toggle="(on) => tick('research', row.node.id, on)"
              @plan="planThis(row.node.id, local(row.node.name))"
            />
          </ul>
          <p v-else class="text-muted-foreground py-6 text-center text-sm">{{ t("progress.allDone") }}</p>
        </TabsContent>

        <TabsContent value="alternates" class="min-h-0 flex-1 overflow-y-auto p-2" data-testid="progress-alternates">
          <div class="flex flex-wrap items-center gap-2 px-1 pb-2">
            <div class="relative min-w-40 flex-1">
              <Search class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" :stroke-width="1.5" />
              <Input v-model="altQuery" class="h-8 pl-8" :placeholder="t('alt.search')" :aria-label="t('alt.search')" data-testid="progress-alt-search" />
            </div>
            <span class="text-muted-foreground text-xs tabular-nums">{{ t("progress.count", { done: altCounts.done, total: altCounts.total }) }}</span>
          </div>
          <section v-for="group in altGroups" :key="group.item" class="mb-3">
            <h3 class="text-muted-foreground px-1 pb-1 text-xs font-medium">{{ group.itemName }}</h3>
            <ul class="bg-card rounded-lg border" role="list">
              <ProgressRow
                v-for="row in group.rows"
                :key="row.recipe.id"
                :label="row.name"
                :done="row.isDone"
                :needs="row.needs"
                testid="progress-alternate"
                @toggle="(on) => update((current) => setAlternate(current, row.recipe.id, on))"
              />
            </ul>
          </section>
          <p v-if="!altGroups.length" class="text-muted-foreground py-6 text-center text-sm">{{ altQuery ? t("alt.none", { query: altQuery }) : t("progress.allDone") }}</p>
        </TabsContent>
      </div>
    </Tabs>
  </div>
</template>
