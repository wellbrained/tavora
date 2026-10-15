<script setup lang="ts">
// Settings > Modules: what is installed and where it came from, and the
// player's own modules folder, the same way themes have theirs. Dropping a
// module package into the folder and pressing Reload adds it; Remove moves it
// to the recycle bin. A module's data stays, so adding it again finds it.
import { FolderOpen, RefreshCw, Trash2 } from "@lucide/vue";
import { computed } from "vue";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { act, confirmAction, state, submitAction } from "../../host";
import SettingRow from "./SettingRow.vue";

defineProps<{ highlight: string | null }>();

type ModuleView = NonNullable<typeof state.value>["modules"][number];

const modules = computed(() => state.value!.modules);
const problems = computed(() => state.value!.moduleProblems);

// Modules for players first (Tavora's own, then the player's), examples last.
const sorted = computed(() => {
  const rank = (module: ModuleView) => (module.development ? 2 : module.provenance === "official" ? 0 : 1);
  return [...modules.value].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
});

/** Panels of a module that are open in the current game, so Remove can say what closes. */
function openCount(moduleId: string): number {
  return state.value!.panels.filter((panel) => panel.moduleId === moduleId).length;
}

function remove(module: ModuleView) {
  confirmAction({
    title: `Remove ${module.name}?`,
    message:
      "Its folder moves to the recycle bin and its panels close in every game. Its notes and other data stay on this PC, so adding the module again brings them back.",
    confirm: "Remove",
    danger: true,
    run: () => submitAction({ type: "remove-module", moduleId: module.id }),
  });
}
</script>

<template>
  <h2 class="mb-4 text-xl font-semibold">Modules</h2>

  <SettingRow
    label="Your own modules"
    description="Put a module's folder into your modules folder, then press Reload. Only add modules from people you trust: a module runs on your PC and can see the game it is opened in."
    setting="own-modules"
    :highlighted="highlight === 'own-modules'"
  >
    <span class="flex flex-none flex-wrap justify-end gap-2">
      <Button variant="secondary" data-testid="open-modules-folder" @click="act({ type: 'open-modules-folder' })">
        <FolderOpen :stroke-width="1.5" /> Open folder
      </Button>
      <Button variant="secondary" data-testid="reload-modules" @click="act({ type: 'reload-modules' })"><RefreshCw :stroke-width="1.5" /> Reload</Button>
    </span>
  </SettingRow>
  <ul v-if="problems.length" class="-mt-2 mb-2 flex flex-col gap-1.5 py-2" aria-label="Modules that could not be loaded" data-testid="module-problems">
    <li v-for="problem in problems" :key="problem.folder" class="text-sm">
      <span class="text-destructive font-medium">{{ problem.folder }}</span>
      <span class="text-muted-foreground"> could not be loaded: {{ problem.message }}.</span>
    </li>
  </ul>

  <div
    :class="cn('-mx-3 rounded-lg px-3 pt-4 transition-colors duration-500', highlight === 'installed-modules' && 'bg-primary/10')"
    data-setting="installed-modules"
  >
    <p class="font-medium">Installed modules</p>
    <ul class="mt-2 flex flex-col" aria-label="Installed modules" data-testid="module-list">
      <li
        v-for="module in sorted"
        :key="module.id"
        class="flex items-center gap-4 border-b py-3 last:border-b-0"
        :data-testid="`module-${module.id}`"
      >
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="flex items-center gap-2">
            <span class="truncate font-medium">{{ module.name }}</span>
            <span class="text-muted-foreground flex-none text-xs tabular-nums">{{ module.version }}</span>
            <span
              :class="cn('flex-none rounded-sm border px-1.5 text-xs', module.provenance === 'official' ? 'border-primary/40 text-primary' : 'text-muted-foreground')"
              >{{ module.provenance === "official" ? "Official" : "Local" }}</span
            >
          </span>
          <span v-if="module.description" class="text-muted-foreground line-clamp-2 text-sm">{{ module.description }}</span>
          <span class="text-muted-foreground text-xs" :data-testid="`module-origin-${module.id}`">{{ module.origin }}</span>
        </div>
        <Button
          v-if="module.removable"
          variant="secondary"
          :aria-label="`Remove ${module.name}`"
          :title="openCount(module.id) ? 'Its open panels close' : undefined"
          :data-testid="`remove-module-${module.id}`"
          @click="remove(module)"
        >
          <Trash2 :stroke-width="1.5" /> Remove
        </Button>
      </li>
    </ul>
  </div>
</template>
