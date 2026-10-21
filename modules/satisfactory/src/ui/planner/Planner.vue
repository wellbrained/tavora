<script setup lang="ts">
// The Planner: pick a plan and a world, say what to make and what is already
// supplied, and see the machines it takes. Every change is solved at once and
// saved shortly after; each panel remembers its plan through panel.setContent.
import { Ellipsis, FileDown, FileUp, Globe, ListChecks, Pencil, Plus, Trash2 } from "@lucide/vue";
import { ConfirmDialog, errorMessage, serial } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@tavora/official-ui/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@tavora/official-ui/components/ui/select";
import { TavoraError } from "@tavora/sdk";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import type { Plan, World } from "../../contracts/plan";
import type { Stored } from "../../contracts/repository";
import { language, t } from "../../i18n";
import { parsePlannerContent } from "../content";
import { useModule, useNames } from "../context";
import { solveErrorText } from "../describe";
import { canPlan, chooseRecipe, emptyPlan, planForItem, setAlternate, uniqueName } from "../planEdit";
import AlternatesDialog from "./AlternatesDialog.vue";
import NameDialog from "./NameDialog.vue";
import RateEditor from "./RateEditor.vue";
import ResultView from "./ResultView.vue";

/** How long typing may pause before the plan is saved. */
const SAVE_DELAY_MS = 400;
/** The plan a panel shows when it is added; per game, shared by the module's panels. */
const LAST_PLAN_KEY = "planner.lastPlan";

const context = useModule();
const { sdk } = context;
const { data, repository, solve } = context.services;
const names = useNames(context);

const plans = shallowRef<Stored<Plan>[]>([]);
const worlds = shallowRef<Stored<World>[]>([]);
const planId = ref<string | null>(null);
/** This panel's working copy of the plan; always replaced, never changed in place. */
const plan = shallowRef<Plan | null>(null);
const ready = ref(false);
let revision = 0;

type NameDialogKind = "newPlan" | "renamePlan" | "newWorld" | "renameWorld";
const nameDialog = ref<NameDialogKind | null>(null);
const confirmDelete = ref(false);
const showAlternates = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

const world = computed(() => worlds.value.find((entry) => entry.id === plan.value?.worldId) ?? null);
const sortedPlans = computed(() => [...plans.value].sort((a, b) => a.value.name.localeCompare(b.value.name) || a.id.localeCompare(b.id)));
const solved = computed(() => (plan.value && world.value && plan.value.targets.length ? solve({ data, plan: plan.value, world: world.value.value }) : null));
const errorText = computed(() => (solved.value && !solved.value.ok ? solveErrorText(solved.value.error, data, language.value, t) : ""));

/** The SDK's CONFLICT: someone saved since this panel last read it. */
const isConflict = (error: unknown) => (error instanceof TavoraError || error instanceof Error) && (error as { code?: unknown }).code === "CONFLICT";

// ── Saving ───────────────────────────────────────────────────────────

const run = serial();
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let dirty = false;

function edit(change: (current: Plan) => Plan) {
  if (!plan.value) return;
  plan.value = change(plan.value);
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flush(), SAVE_DELAY_MS);
}

/** Saves pending edits now. When another panel saved first, this panel shows the newest version instead. */
function flush(): Promise<void> {
  clearTimeout(saveTimer);
  return run(async () => {
    const id = planId.value;
    const value = plan.value;
    if (!dirty || !id || !value) return;
    dirty = false;
    try {
      const before = plans.value.find((entry) => entry.id === id)?.value.name;
      const stored = await repository.putPlan(value, { id, ifRevision: revision });
      remember(stored);
      if (planId.value === id) {
        revision = stored.revision;
        if (stored.value.name !== before) void sdk.panel.setContent({ id, title: stored.value.name }).catch(() => undefined);
      }
    } catch (error) {
      if (isConflict(error)) {
        await reload(id);
        context.notify(t("notice.conflict"));
      } else {
        dirty = true;
        context.notify(t("notice.saveFailed", { error: errorMessage(error) }));
      }
    }
  });
}

function remember(stored: Stored<Plan>) {
  plans.value = plans.value.some((entry) => entry.id === stored.id)
    ? plans.value.map((entry) => (entry.id === stored.id ? stored : entry))
    : [...plans.value, stored];
}

/** Shows the stored version of the plan, dropping this panel's unsaved edits. */
async function reload(id: string) {
  const stored = await repository.getPlan(id);
  if (planId.value !== id) return;
  if (!stored) return planGone();
  dirty = false;
  plan.value = stored.value;
  revision = stored.revision;
  remember(stored);
}

async function planGone() {
  context.notify(t("notice.planGone"));
  dirty = false;
  planId.value = null;
  plan.value = null;
  plans.value = await repository.listPlans();
  await openFallback();
}

// ── Opening plans ────────────────────────────────────────────────────

async function open(id: string): Promise<boolean> {
  if (id === planId.value) return true;
  await flush();
  const stored = await repository.getPlan(id);
  if (!stored) return false;
  planId.value = id;
  plan.value = stored.value;
  revision = stored.revision;
  remember(stored);
  await sdk.panel.setContent({ id, title: stored.value.name }).catch(() => undefined);
  void sdk.storage.set(LAST_PLAN_KEY, id).catch(() => undefined);
  return true;
}

async function create(value: Plan): Promise<boolean> {
  await flush();
  const stored = await repository.putPlan(value);
  remember(stored);
  return open(stored.id);
}

/** What a panel shows when it is told nothing: the plan used last, else the first one, else the empty state. */
async function openFallback() {
  const last = await sdk.storage.get<string>(LAST_PLAN_KEY).catch(() => null);
  if (typeof last === "string" && plans.value.some((entry) => entry.id === last) && (await open(last))) return;
  const first = sortedPlans.value[0];
  if (first && (await open(first.id))) return;
  await sdk.panel.setContent(null).catch(() => undefined);
}

/** Content from Tavora: a plan's id, or `new-plan:<item>` from the Codex's "Plan this". */
async function show(contentId: string): Promise<boolean> {
  const content = parsePlannerContent(contentId);
  if (!content) return false;
  if (content.kind === "plan") return open(content.planId);
  if (!data.items[content.item]) return false;
  const worldId = world.value?.id ?? (await repository.ensureWorld()).id;
  return create(planForItem(data, content.item, names.item(content.item), worldId));
}

const cleanup: (() => void)[] = [];

onMounted(async () => {
  try {
    await repository.ensureWorld();
    [worlds.value, plans.value] = await Promise.all([repository.listWorlds(), repository.listPlans()]);
    const launch = await sdk.panel.getLaunch().catch(() => ({ reason: "add" as const }));
    const content = launch.reason === "add" ? null : launch.content;
    if (!(content && (await show(content.id)))) await openFallback();
    cleanup.push(
      sdk.panel.onNavigate(async (next) => {
        if (!(await show(next.id))) throw new Error("nothing to show");
      }),
      repository.onChange((change) => void onOtherPanel(change.kind, change.id, change.deleted)),
      sdk.lifecycle.onSuspend(() => void flush()),
      sdk.lifecycle.onDispose(() => void flush()),
    );
  } catch (error) {
    context.notify(errorMessage(error));
  } finally {
    ready.value = true;
  }
});

onBeforeUnmount(() => {
  void flush();
  cleanup.forEach((fn) => fn());
});

async function onOtherPanel(kind: "world" | "plan", id: string, deleted: boolean) {
  if (kind === "world") {
    worlds.value = await repository.listWorlds();
    return;
  }
  plans.value = await repository.listPlans();
  if (id !== planId.value) return;
  if (deleted) await planGone();
  // With edits of its own pending, the panel's next save finds the conflict and reloads then.
  else if (!dirty) await run(() => reload(id));
}

// ── Toolbar ──────────────────────────────────────────────────────────

function onPickPlan(id: unknown) {
  if (typeof id === "string" && id) void open(id);
}

function onPickWorld(id: unknown) {
  if (typeof id === "string" && id && id !== plan.value?.worldId) edit((current) => ({ ...current, worldId: id }));
}

const currentWorldId = () => world.value?.id ?? worlds.value[0]?.id ?? "";

const nameDialogProps = computed(() => {
  switch (nameDialog.value) {
    case "newPlan":
      return { title: t("dialog.newPlan"), initial: uniqueName(t("planner.newPlan"), plans.value.map((entry) => entry.value.name)), confirm: t("dialog.create") };
    case "renamePlan":
      return { title: t("dialog.renamePlan"), initial: plan.value?.name ?? "", confirm: t("dialog.save") };
    case "newWorld":
      return {
        title: t("dialog.newWorld"),
        description: t("dialog.newWorldHint"),
        initial: uniqueName(t("planner.newWorld"), worlds.value.map((entry) => entry.value.name)),
        confirm: t("dialog.create"),
      };
    case "renameWorld":
      return { title: t("dialog.renameWorld"), initial: world.value?.value.name ?? "", confirm: t("dialog.save") };
    default:
      return null;
  }
});

async function applyName(name: string) {
  const kind = nameDialog.value;
  nameDialog.value = null;
  try {
    if (kind === "newPlan") await create(emptyPlan(name, currentWorldId()));
    else if (kind === "renamePlan") {
      edit((current) => ({ ...current, name }));
      await flush();
    } else if (kind === "newWorld") {
      const stored = await repository.putWorld({ format: "tavora.satisfactory.world", version: 1, name, unlockedAlternates: [], showAllAlternates: false });
      worlds.value = await repository.listWorlds();
      edit((current) => ({ ...current, worldId: stored.id }));
    } else if (kind === "renameWorld" && world.value) await updateWorld(world.value.id, (current) => ({ ...current, name }));
  } catch (error) {
    context.notify(t("notice.saveFailed", { error: errorMessage(error) }));
  }
}

/** Changes a world; when another panel changed it first, the change is made again on the newest version. */
function updateWorld(id: string, change: (current: World) => World): Promise<void> {
  return run(async () => {
    let current = worlds.value.find((entry) => entry.id === id) ?? (await repository.getWorld(id));
    for (let attempt = 1; current; attempt++) {
      try {
        const stored = await repository.putWorld(change(current.value), { id, ifRevision: current.revision });
        worlds.value = worlds.value.map((entry) => (entry.id === id ? stored : entry));
        return;
      } catch (error) {
        if (!isConflict(error) || attempt >= 5) throw error;
        current = await repository.getWorld(id);
      }
    }
  });
}

function setWorldAlternate(recipe: string, unlocked: boolean) {
  if (world.value) void updateWorld(world.value.id, (current) => setAlternate(current, recipe, unlocked)).catch((error) => context.notify(t("notice.saveFailed", { error: errorMessage(error) })));
}

function setShowAll(on: boolean) {
  if (world.value) void updateWorld(world.value.id, (current) => ({ ...current, showAllAlternates: on })).catch((error) => context.notify(t("notice.saveFailed", { error: errorMessage(error) })));
}

async function deletePlan() {
  confirmDelete.value = false;
  const id = planId.value;
  if (!id) return;
  clearTimeout(saveTimer);
  dirty = false;
  try {
    await run(() => repository.deletePlan(id));
    planId.value = null;
    plan.value = null;
    plans.value = await repository.listPlans();
    await openFallback();
  } catch (error) {
    context.notify(t("notice.saveFailed", { error: errorMessage(error) }));
  }
}

async function exportPlan() {
  const id = planId.value;
  if (!id || !plan.value) return;
  try {
    await flush();
    const { fileName } = await sdk.files.exportJson(await repository.exportPlan(id), plan.value.name);
    context.notify(t("notice.exported", { file: fileName }));
  } catch {
    context.notify(t("notice.exportFailed"));
  }
}

async function onImportFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  let json: unknown;
  try {
    json = JSON.parse(await file.text());
  } catch {
    context.notify(t("notice.notJson"));
    return;
  }
  try {
    const worldId = currentWorldId() || (await repository.ensureWorld()).id;
    const stored = await repository.importPlan(json, worldId);
    remember(stored);
    await open(stored.id);
    context.notify(t("notice.imported", { name: stored.value.name }));
  } catch (error) {
    context.notify(t("notice.importFailed", { error: errorMessage(error) }));
  }
}

// ── Recipes ──────────────────────────────────────────────────────────

function useStandardRecipe(item: string) {
  edit((current) => {
    const recipeChoices = { ...current.recipeChoices };
    delete recipeChoices[item];
    return { ...current, recipeChoices };
  });
}

const canTarget = (item: string) => canPlan(data, item);
</script>

<template>
  <div class="relative flex h-full min-h-0 flex-col" data-testid="planner">
    <header
      class="border-primary/25 bg-primary/5 @container flex h-10 flex-none items-center gap-1 border-b px-2"
      role="toolbar"
      :aria-label="t('planner.toolbar')"
      data-testid="planner-toolbar"
    >
      <Select v-if="plans.length" :model-value="planId ?? undefined" @update:model-value="onPickPlan">
        <SelectTrigger size="sm" class="min-w-0 flex-1 @2xl:max-w-72" :aria-label="t('planner.plan')" data-testid="plan-picker">
          <SelectValue :placeholder="t('planner.pickPlan')" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="entry in sortedPlans" :key="entry.id" :value="entry.id">{{ entry.value.name }}</SelectItem>
        </SelectContent>
      </Select>
      <span v-else class="flex-1" />

      <Select
        v-if="plan && worlds.length"
        :model-value="plan.worldId"
        @update:model-value="onPickWorld"
      >
        <SelectTrigger size="sm" class="max-w-36 min-w-0 @2xl:max-w-56" :aria-label="t('planner.world')" :title="t('planner.world')" data-testid="world-picker">
          <Globe class="size-4" :stroke-width="1.5" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="entry in worlds" :key="entry.id" :value="entry.id">{{ entry.value.name }}</SelectItem>
        </SelectContent>
      </Select>

      <Button
        v-if="plan && world"
        variant="ghost"
        size="sm"
        :aria-label="t('planner.alternates')"
        :title="t('planner.alternates')"
        data-testid="open-alternates"
        @click="showAlternates = true"
      >
        <ListChecks :stroke-width="1.5" />
        <span class="hidden @lg:inline">{{ t("planner.alternates") }}</span>
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="ghost" size="icon-sm" :aria-label="t('planner.more')" :title="t('planner.more')" data-testid="planner-menu">
            <Ellipsis :stroke-width="1.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="min-w-48">
          <DropdownMenuItem data-testid="menu-new-plan" @select="nameDialog = 'newPlan'"><Plus :stroke-width="1.5" />{{ t("planner.newPlan") }}</DropdownMenuItem>
          <DropdownMenuItem :disabled="!plan" data-testid="menu-rename-plan" @select="nameDialog = 'renamePlan'">
            <Pencil :stroke-width="1.5" />{{ t("planner.renamePlan") }}
          </DropdownMenuItem>
          <DropdownMenuItem :disabled="!plan" data-testid="menu-export" @select="exportPlan"><FileDown :stroke-width="1.5" />{{ t("planner.exportPlan") }}</DropdownMenuItem>
          <DropdownMenuItem data-testid="menu-import" @select="fileInput?.click()"><FileUp :stroke-width="1.5" />{{ t("planner.importPlan") }}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel class="text-muted-foreground text-xs font-medium">{{ t("planner.worldHeading") }}</DropdownMenuLabel>
          <DropdownMenuItem data-testid="menu-new-world" @select="nameDialog = 'newWorld'"><Plus :stroke-width="1.5" />{{ t("planner.newWorld") }}</DropdownMenuItem>
          <DropdownMenuItem :disabled="!world" data-testid="menu-rename-world" @select="nameDialog = 'renameWorld'">
            <Pencil :stroke-width="1.5" />{{ t("planner.renameWorld") }}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem :disabled="!plan" class="text-destructive focus:text-destructive" data-testid="menu-delete-plan" @select="confirmDelete = true">
            <Trash2 :stroke-width="1.5" class="text-destructive" />{{ t("planner.deletePlan") }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <input ref="fileInput" type="file" accept=".json,application/json" class="hidden" data-testid="import-file" @change="onImportFile" />
    </header>

    <main class="min-h-0 flex-1 overflow-y-auto">
      <p v-if="!ready" class="text-muted-foreground p-4 text-sm">{{ t("loading") }}</p>

      <div v-else-if="!plan" class="flex flex-col items-center gap-3 px-6 py-12 text-center" data-testid="planner-empty">
        <p class="text-muted-foreground max-w-80 text-sm">{{ t("planner.empty") }}</p>
        <Button data-testid="empty-new-plan" @click="nameDialog = 'newPlan'"><Plus :stroke-width="1.5" />{{ t("planner.newPlan") }}</Button>
      </div>

      <div v-else class="@container">
        <div class="grid gap-4 p-3 @4xl:grid-cols-[22rem_minmax(0,1fr)]">
          <div class="flex min-w-0 flex-col gap-4">
            <section :aria-label="t('planner.targets')" data-testid="targets">
              <h2 class="mb-1.5 text-sm font-semibold">{{ t("planner.targets") }}</h2>
              <RateEditor :rates="plan.targets" :add-label="t('planner.addTarget')" :filter="canTarget" @change="(targets) => edit((current) => ({ ...current, targets }))" />
            </section>
            <section :aria-label="t('planner.fixedInputs')" data-testid="fixed-inputs">
              <h2 class="text-sm font-semibold">{{ t("planner.fixedInputs") }}</h2>
              <p class="text-muted-foreground mb-1.5 text-xs">{{ t("planner.fixedHint") }}</p>
              <RateEditor :rates="plan.fixedInputs" :add-label="t('planner.addFixed')" @change="(fixedInputs) => edit((current) => ({ ...current, fixedInputs }))" />
            </section>
          </div>

          <div class="min-w-0">
            <p v-if="!plan.targets.length" class="text-muted-foreground rounded-lg border border-dashed px-4 py-8 text-center text-sm" data-testid="no-targets">
              {{ t("planner.noTargets") }}
            </p>
            <div v-else-if="solved && !solved.ok" class="border-destructive/40 bg-destructive/10 flex flex-col gap-2 rounded-lg border p-3" role="alert" data-testid="solve-error">
              <p class="text-sm">{{ errorText }}</p>
              <div v-if="solved.error.code === 'LOCKED_RECIPE' || solved.error.code === 'WRONG_RECIPE'" class="flex flex-wrap gap-2">
                <Button v-if="solved.error.code === 'LOCKED_RECIPE'" size="sm" variant="secondary" data-testid="error-alternates" @click="showAlternates = true">
                  {{ t("error.openAlternates") }}
                </Button>
                <Button size="sm" variant="secondary" data-testid="error-standard" @click="useStandardRecipe(solved.error.item)">{{ t("error.useDefault") }}</Button>
              </div>
            </div>
            <ResultView v-else-if="solved && solved.ok" :result="solved.result" @choose-recipe="(item, recipe) => edit((current) => chooseRecipe(current, data, item, recipe))" />
          </div>
        </div>
      </div>
    </main>

    <NameDialog v-if="nameDialogProps" v-bind="nameDialogProps" @apply="applyName" @cancel="nameDialog = null" />
    <ConfirmDialog
      v-if="confirmDelete && plan"
      :title="t('confirm.deletePlan', { name: plan.name })"
      :description="t('confirm.deletePlanHint')"
      :confirm="t('planner.deletePlan')"
      :cancel="t('cancel')"
      @confirm="deletePlan"
      @cancel="confirmDelete = false"
    />
    <AlternatesDialog v-if="showAlternates && world" :world="world.value" @toggle="setWorldAlternate" @show-all="setShowAll" @close="showAlternates = false" />
  </div>
</template>
