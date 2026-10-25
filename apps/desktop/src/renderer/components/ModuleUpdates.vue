<script setup lang="ts">
// The Updates view of the module library: every module with an update waiting, each with its
// versions, what is new since the installed one and its own Update button, and Update all above.
// An update that asks for new access goes through the consent dialog first (GrantDialog.vue).
// Update all installs the ones that ask for nothing new at once, then asks for each other one in turn.
import { CircleAlert, CloudDownload, ShieldQuestion } from "@lucide/vue";
import { computed, reactive } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { act, askForUpdate, state, updateQueue } from "../host";
import { formatDate, t } from "../i18n";
import { asksMore, updateAllPlan, waitingUpdates } from "../../shared/module-updates";
import ModuleIcon from "./ModuleIcon.vue";

const props = defineProps<{ query: string }>();

const waiting = computed(() => waitingUpdates(state.value!.modules));
const shown = computed(() => {
  const text = props.query.trim().toLocaleLowerCase();
  return text ? waiting.value.filter((module) => [module.name, module.id].some((value) => value.toLocaleLowerCase().includes(text))) : waiting.value;
});

/** The modules being updated right now, and the error of one that failed. */
const busy = reactive<Record<string, boolean>>({});
const errors = reactive<Record<string, string>>({});
const working = computed(() => Object.values(busy).some(Boolean));

/** Installs one update that asks for nothing new; its panels reload. */
async function install(id: string): Promise<boolean> {
  const update = state.value?.modules.find((item) => item.id === id)?.update;
  if (!update) return false;
  busy[id] = true;
  delete errors[id];
  const result = await act({ type: "apply-module-update", moduleId: id, version: update.version }, { quiet: true });
  busy[id] = false;
  if (!result.ok) errors[id] = result.error;
  return result.ok;
}

function updateOne(id: string) {
  const module = waiting.value.find((item) => item.id === id);
  if (!module) return;
  if (asksMore(module.update!)) {
    delete errors[id];
    updateQueue.value = [];
    askForUpdate(id);
  } else void install(id);
}

async function updateAll() {
  const plan = updateAllPlan(waiting.value);
  for (const id of plan.now) await install(id);
  const [first, ...rest] = plan.ask;
  if (first === undefined) return;
  updateQueue.value = rest;
  askForUpdate(first);
}
</script>

<template>
  <div class="min-h-0 flex-1 overflow-y-auto px-5 pb-8 sm:px-8" data-testid="module-updates">
    <div v-if="!shown.length" class="text-muted-foreground py-16 text-center" data-testid="module-updates-empty">
      <p>{{ t("addModule.updates.empty") }}</p>
    </div>
    <template v-else>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2 pt-6">
        <Button :disabled="working" data-testid="update-all-modules" @click="updateAll">
          <CloudDownload :stroke-width="1.5" /> {{ working ? t("addModule.updates.working") : t("addModule.updates.all") }}
        </Button>
        <p class="text-muted-foreground text-sm">{{ t("addModule.updates.reload") }}</p>
      </div>
      <ul class="flex flex-col gap-3 pt-4" :aria-label="t('addModule.updates.list')">
        <li v-for="module in shown" :key="module.id" class="bg-background/40 flex flex-col gap-3 rounded-xl border p-4" :data-testid="`update-${module.id}`">
          <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span class="bg-primary/10 border-primary/20 text-primary flex size-10 shrink-0 items-center justify-center rounded-lg border" aria-hidden="true">
              <ModuleIcon :module-id="module.id" size="size-5" />
            </span>
            <div class="min-w-0 flex-1 basis-48">
              <p class="truncate font-medium" :title="module.name">{{ module.name }}</p>
              <p class="text-muted-foreground text-sm tabular-nums" :data-testid="`update-versions-${module.id}`">{{ module.version }} → {{ module.update!.version }}</p>
            </div>
            <Button
              size="sm"
              :disabled="busy[module.id]"
              :aria-label="t('addModule.updates.updateLabel', { name: module.name })"
              :data-testid="`update-module-${module.id}`"
              @click="updateOne(module.id)"
            >
              {{ busy[module.id] ? t("addModule.updates.working") : t("addModule.updates.update") }}
            </Button>
          </div>
          <p v-if="asksMore(module.update!)" class="text-muted-foreground flex items-center gap-2 text-sm">
            <ShieldQuestion class="size-4 flex-none" :stroke-width="1.5" aria-hidden="true" /> {{ t("addModule.updates.askFirst") }}
          </p>
          <div v-if="module.update!.notes.length" class="bg-muted/40 flex max-h-48 flex-col gap-3 overflow-y-auto rounded-md px-4 py-3" :data-testid="`update-notes-${module.id}`">
            <article v-for="entry in module.update!.notes" :key="entry.version">
              <header class="mb-1 flex flex-wrap items-baseline gap-x-3">
                <h4 class="font-semibold tabular-nums">{{ entry.version }}</h4>
                <span v-if="entry.date" class="text-muted-foreground text-sm">{{ formatDate(entry.date) }}</span>
              </header>
              <ul class="text-muted-foreground flex list-disc flex-col gap-1 pl-5 text-sm">
                <li v-for="(note, index) in entry.notes" :key="index">{{ note }}</li>
              </ul>
            </article>
          </div>
          <p v-if="errors[module.id]" class="text-destructive flex items-center gap-2 text-sm" role="alert" :data-testid="`update-error-${module.id}`">
            <CircleAlert class="size-4 flex-none" :stroke-width="1.5" aria-hidden="true" /> {{ errors[module.id] }}
          </p>
        </li>
      </ul>
    </template>
  </div>
</template>
