<script setup lang="ts">
// The module library: every installed module, to open in the current game.
import { computed, ref } from "vue";
import { act, dialog, nextPanelSlot, state, type AddModuleRequest } from "../host";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { t } from "../i18n";
import ModalDialog from "./ModalDialog.vue";
import ModuleIcon from "./ModuleIcon.vue";

/** Who publishes a module: Tavora itself, or a package found on this computer. */
const provenanceLabel = (provenance: "official" | "local") => (provenance === "official" ? t("common.official") : t("common.local"));

type Category = "all" | "official" | "local" | "development";

const CATEGORY_IDS: Category[] = ["all", "official", "local", "development"];
const CATEGORIES = computed(() => CATEGORY_IDS.map((id) => ({ id, label: t(`addModule.category.${id}`) })));

type ModuleView = NonNullable<typeof state.value>["modules"][number];

/** The one category a module is listed under; playgrounds and examples go to Development. */
function categoryOf(module: ModuleView): Exclude<Category, "all"> {
  return module.development ? "development" : module.provenance;
}

const query = ref("");
const category = ref<Category>("all");

function count(id: Category): number {
  return state.value!.modules.filter((module) => id === "all" || categoryOf(module) === id).length;
}

const groups = computed(() => {
  const text = query.value.trim().toLowerCase();
  const matches = state.value!.modules.filter(
    (module) => !text || module.name.toLowerCase().includes(text) || (module.description ?? "").toLowerCase().includes(text),
  );
  return CATEGORIES.value.filter((item) => item.id !== "all")
    .map((item) => ({ ...item, items: matches.filter((module) => categoryOf(module) === item.id) }))
    .filter((group) => group.items.length && (category.value === "all" || category.value === group.id));
});

/** How many panels of a module are already open in this game. */
function openCount(moduleId: string): number {
  return state.value!.panels.filter((panel) => panel.moduleId === moduleId).length;
}

function add(moduleId: string) {
  nextPanelSlot.value = (dialog.value as AddModuleRequest).slot ?? null;
  dialog.value = null;
  void act({ type: "open-module", moduleId });
}

/** Enter opens the first module that can run in this game. */
function submit() {
  const first = groups.value.flatMap((group) => group.items).find((module) => module.available);
  if (first) add(first.id);
}
</script>

<template>
  <ModalDialog :title="t('addModule.title')" class="sm:max-w-[720px]" testid="add-module-dialog" @close="dialog = null">
    <form @submit.prevent="submit">
      <label class="sr-only" for="module-search">{{ t("addModule.search") }}</label>
      <Input id="module-search" v-model="query" :placeholder="t('addModule.search')" autocomplete="off" data-testid="module-search" autofocus />
    </form>
    <div class="flex min-h-0 gap-4">
      <nav class="flex w-44 flex-none flex-col gap-0.5" :aria-label="t('addModule.categories')">
        <button
          v-for="item in CATEGORIES"
          :key="item.id"
          type="button"
          :class="
            cn(
              'hover:bg-accent flex h-9 items-center justify-between rounded-md px-3 text-left text-sm',
              category === item.id && 'bg-accent text-foreground ring-primary/40 font-medium ring-1',
            )
          "
          :aria-pressed="category === item.id"
          :data-testid="`module-category-${item.id}`"
          @click="category = item.id"
        >
          <span class="truncate">{{ item.label }}</span>
          <span class="text-muted-foreground text-xs tabular-nums">{{ count(item.id) }}</span>
        </button>
      </nav>
      <div class="flex max-h-[min(440px,60vh)] min-w-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
        <section v-for="group in groups" :key="group.id" :aria-label="group.label">
          <h3 class="text-muted-foreground pb-1.5 text-xs font-medium">{{ group.label }}</h3>
          <ul class="flex flex-col gap-2">
            <li
              v-for="module in group.items"
              :key="module.id"
              :class="cn('bg-card flex items-start gap-3 rounded-lg border p-3', !module.available && 'opacity-60')"
              :data-testid="`module-${module.id}`"
            >
              <span
                class="bg-background text-primary flex size-10 flex-none items-center justify-center rounded-[10px] border text-base font-semibold"
                aria-hidden="true"
                ><ModuleIcon :module-id="module.id" size="size-5" /></span
              >
              <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                <span class="flex items-center gap-2">
                  <span class="truncate font-medium">{{ module.name }}</span>
                  <span
                    :class="
                      cn(
                        'flex-none rounded-sm border px-1.5 text-xs',
                        module.provenance === 'official' ? 'border-primary/40 text-primary' : 'text-muted-foreground',
                      )
                    "
                    :data-testid="`provenance-${module.id}`"
                    >{{ provenanceLabel(module.provenance) }}</span
                  >
                </span>
                <span v-if="!module.available" class="text-muted-foreground text-sm">{{ t("addModule.unsupported") }}</span>
                <span v-else-if="module.description" class="text-muted-foreground line-clamp-2 text-sm">{{ module.description }}</span>
              </span>
              <span class="flex flex-none flex-col items-end gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  class="border-primary/50 text-primary hover:bg-primary/10 hover:text-primary"
                  :data-testid="`open-${module.id}`"
                  :disabled="!module.available"
                  :aria-label="t('addModule.addLabel', { name: module.name })"
                  @click="add(module.id)"
                >
                  {{ t("common.add") }}
                </Button>
                <span v-if="openCount(module.id)" class="text-muted-foreground text-xs">{{ t("addModule.open", { count: openCount(module.id) }) }}</span>
              </span>
            </li>
          </ul>
        </section>
        <p v-if="!groups.length" class="text-muted-foreground py-6 text-center text-sm" data-testid="module-search-empty">
          {{ t("addModule.none", { query: query.trim() }) }}
        </p>
      </div>
    </div>
  </ModalDialog>
</template>
