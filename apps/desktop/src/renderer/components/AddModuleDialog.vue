<script setup lang="ts">
// The module library: every installed module, to open in the current game.
import { computed, ref } from "vue";
import { act, dialog, state } from "../host";
import { Input } from "@/components/ui/input";
import ModalDialog from "./ModalDialog.vue";

/** Who publishes a module: Tavora itself, or a package found on this computer. */
const PROVENANCE_LABEL = { official: "Official", local: "Local" } as const;

const query = ref("");

const groups = computed(() => {
  const text = query.value.trim().toLowerCase();
  const matches = state.value!.modules.filter(
    (module) => !text || module.name.toLowerCase().includes(text) || (module.description ?? "").toLowerCase().includes(text),
  );
  return [
    { label: "Official", items: matches.filter((module) => module.provenance === "official") },
    { label: "On this computer", items: matches.filter((module) => module.provenance === "local") },
  ].filter((group) => group.items.length);
});

/** How many panels of a module are already open in this game. */
function openCount(moduleId: string): number {
  return state.value!.panels.filter((panel) => panel.moduleId === moduleId).length;
}

function add(moduleId: string) {
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
  <ModalDialog title="Add a module" class="sm:max-w-[560px]" testid="add-module-dialog" @close="dialog = null">
    <form @submit.prevent="submit">
      <label class="sr-only" for="module-search">Search modules</label>
      <Input id="module-search" v-model="query" placeholder="Search modules" autocomplete="off" data-testid="module-search" autofocus />
    </form>
    <div class="-mx-2 flex max-h-[min(420px,60vh)] flex-col gap-3 overflow-y-auto">
      <section v-for="group in groups" :key="group.label" :aria-label="group.label">
        <h3 class="text-muted-foreground px-2 pb-1 text-xs font-medium">{{ group.label }}</h3>
        <ul>
          <li v-for="module in group.items" :key="module.id">
            <button
              type="button"
              class="hover:bg-accent focus-visible:bg-accent flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left disabled:pointer-events-none disabled:opacity-50"
              :data-testid="`open-${module.id}`"
              :disabled="!module.available"
              @click="add(module.id)"
            >
              <span
                class="bg-card text-primary flex size-10 flex-none items-center justify-center rounded-[10px] text-base font-semibold shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]"
                aria-hidden="true"
                >{{ [...module.name][0] }}</span
              >
              <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                <span class="flex items-center gap-2">
                  <span class="truncate font-medium">{{ module.name }}</span>
                  <span class="text-muted-foreground bg-background flex-none rounded-sm px-1 text-xs" :data-testid="`provenance-${module.id}`">{{
                    PROVENANCE_LABEL[module.provenance]
                  }}</span>
                </span>
                <span v-if="!module.available" class="text-muted-foreground text-sm">Does not support this game</span>
                <span v-else-if="module.description" class="text-muted-foreground line-clamp-2 text-sm">{{ module.description }}</span>
              </span>
              <span v-if="openCount(module.id)" class="text-muted-foreground flex-none pt-0.5 text-xs">{{
                openCount(module.id) === 1 ? "Open" : `${openCount(module.id)} open`
              }}</span>
            </button>
          </li>
        </ul>
      </section>
      <p v-if="!groups.length" class="text-muted-foreground px-2 py-6 text-center text-sm" data-testid="module-search-empty">
        No module matches "{{ query.trim() }}".
      </p>
    </div>
  </ModalDialog>
</template>
