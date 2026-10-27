<script setup lang="ts">
import { Plus } from "@lucide/vue";
import { computed } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import WorkspaceIcon from "../components/WorkspaceIcon.vue";
import { act, dialog, state } from "../host";
import { t } from "../i18n";

const library = computed(() => state.value!.library);
const recent = computed(() => library.value.recent.map((id) => library.value.workspaces[id]!).filter(Boolean));
const empty = computed(() => Object.keys(library.value.workspaces).length === 0);
</script>

<template>
  <main class="flex h-full flex-col items-center overflow-y-auto px-8 pt-16 pb-8 text-center" data-testid="welcome">
    <img class="mb-6" src="/brand/emblem-240.png" alt="" width="111" height="120" draggable="false" />
    <h1 class="text-3xl font-semibold">{{ empty ? t("welcome.title.new") : t("welcome.title.back") }}</h1>
    <p class="text-muted-foreground mt-2 mb-8">{{ t("welcome.tagline") }}</p>

    <section v-if="empty" class="flex flex-col items-center gap-4">
      <p>{{ t("welcome.addFirst") }}</p>
      <Button data-testid="welcome-add-game" @click="dialog = { kind: 'add-game' }">
        <Plus :stroke-width="1.5" /> {{ t("common.addGame") }}
      </Button>
    </section>

    <section v-else class="w-full max-w-[720px]" aria-labelledby="recent-title">
      <h2 id="recent-title" class="text-muted-foreground mb-4 text-sm font-medium">{{ t("welcome.recent") }}</h2>
      <ul class="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2">
        <li v-for="workspace in recent" :key="workspace.id">
          <button
            type="button"
            class="hover:bg-card flex w-full flex-col items-center gap-2 rounded-lg px-2 py-3"
            :data-testid="`recent-${workspace.id}`"
            @click="act({ type: 'open-workspace', workspaceId: workspace.id })"
          >
            <WorkspaceIcon :workspace="workspace" :size="64" />
            <span class="max-w-full truncate text-sm">{{ workspace.name }}</span>
          </button>
        </li>
        <li>
          <button
            type="button"
            class="hover:bg-card flex w-full flex-col items-center gap-2 rounded-lg px-2 py-3"
            data-testid="welcome-add-game"
            @click="dialog = { kind: 'add-game' }"
          >
            <span class="border-input text-muted-foreground grid size-16 place-items-center rounded-2xl border border-dashed">
              <Plus class="size-6" :stroke-width="1.5" />
            </span>
            <span class="text-muted-foreground text-sm">{{ t("common.addGame") }}</span>
          </button>
        </li>
      </ul>
    </section>
  </main>
</template>
