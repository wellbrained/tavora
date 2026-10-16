<script setup lang="ts">
// Settings > Modules: what is installed and where it came from, and the
// player's own modules folder, the same way themes have theirs. Install from
// zip checks and unpacks a module zip into the folder; dropping a module
// package into the folder and pressing Reload adds it too. Remove moves it
// to the recycle bin. A module's data stays, so adding it again finds it.
import { FileArchive, FolderOpen, RefreshCw, Trash2 } from "@lucide/vue";
import { computed } from "vue";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { act, confirmAction, showToast, state, submitAction } from "../../host";
import { t } from "../../i18n";
import ModuleIcon from "../ModuleIcon.vue";
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

async function install() {
  const result = await act({ type: "install-module" });
  if (!result.ok || !result.id) return;
  const module = modules.value.find((item) => item.id === result.id);
  if (module) showToast(t("settings.modules.installed", { name: module.name, version: module.version }));
}

function remove(module: ModuleView) {
  confirmAction({
    title: t("settings.modules.removeTitle", { name: module.name }),
    message: t("settings.modules.removeMessage"),
    confirm: t("common.remove"),
    danger: true,
    run: () => submitAction({ type: "remove-module", moduleId: module.id }),
  });
}
</script>

<template>
  <SettingRow
    :label="t('settings.own-modules.label')"
    :description="t('settings.own-modules.description')"
    setting="own-modules"
    :highlighted="highlight === 'own-modules'"
  >
    <span class="flex flex-none flex-wrap justify-end gap-2">
      <Button variant="secondary" data-testid="install-module" @click="install">
        <FileArchive :stroke-width="1.5" /> {{ t("settings.modules.install") }}
      </Button>
      <Button variant="secondary" data-testid="open-modules-folder" @click="act({ type: 'open-modules-folder' })">
        <FolderOpen :stroke-width="1.5" /> {{ t("common.openFolder") }}
      </Button>
      <Button variant="secondary" data-testid="reload-modules" @click="act({ type: 'reload-modules' })"><RefreshCw :stroke-width="1.5" /> {{ t("common.reload") }}</Button>
    </span>
  </SettingRow>
  <ul v-if="problems.length" class="-mt-2 mb-2 flex flex-col gap-1.5 py-2" :aria-label="t('settings.modules.problems')" data-testid="module-problems">
    <li v-for="problem in problems" :key="problem.folder" class="text-sm">
      <span class="text-destructive font-medium">{{ problem.folder }}</span>
      <span class="text-muted-foreground"> {{ t("settings.modules.problem", { folder: "", message: problem.message }).trim() }}</span>
    </li>
  </ul>

  <div
    :class="cn('-mx-3 rounded-lg px-3 pt-4 transition-colors duration-500', highlight === 'installed-modules' && 'bg-primary/10')"
    data-setting="installed-modules"
  >
    <p class="font-medium">{{ t("settings.installed-modules.label") }}</p>
    <ul class="mt-2 flex flex-col" :aria-label="t('settings.installed-modules.label')" data-testid="module-list">
      <li
        v-for="module in sorted"
        :key="module.id"
        class="flex items-center gap-4 border-b py-3 last:border-b-0"
        :data-testid="`module-${module.id}`"
      >
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="flex items-center gap-2">
            <ModuleIcon :module-id="module.id" />
            <span class="truncate font-medium">{{ module.name }}</span>
            <span class="text-muted-foreground flex-none text-xs tabular-nums">{{ module.version }}</span>
            <span
              :class="cn('flex-none rounded-sm border px-1.5 text-xs', module.provenance === 'official' ? 'border-primary/40 text-primary' : 'text-muted-foreground')"
              >{{ module.provenance === "official" ? t("common.official") : t("common.local") }}</span
            >
            <span
              v-if="module.publisher"
              class="text-muted-foreground flex-none rounded-sm border px-1.5 font-mono text-xs"
              :title="t('settings.modules.publisherHint', { key: module.publisher })"
              :data-testid="`module-publisher-${module.id}`"
              >{{ t("settings.modules.publisher", { short: module.publisher.slice(0, 8) }) }}</span
            >
          </span>
          <span v-if="module.description" class="text-muted-foreground line-clamp-2 text-sm">{{ module.description }}</span>
          <span class="text-muted-foreground text-xs" :data-testid="`module-origin-${module.id}`">{{ t(`modules.origin.${module.origin.kind}`, { folder: module.origin.folder }) }}</span>
        </div>
        <Button
          v-if="module.removable"
          variant="secondary"
          :aria-label="t('settings.modules.removeLabel', { name: module.name })"
          :title="openCount(module.id) ? t('settings.modules.removeHint') : undefined"
          :data-testid="`remove-module-${module.id}`"
          @click="remove(module)"
        >
          <Trash2 :stroke-width="1.5" /> {{ t("common.remove") }}
        </Button>
      </li>
    </ul>
  </div>
</template>
