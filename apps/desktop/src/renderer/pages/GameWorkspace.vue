<script setup lang="ts">
import { Plus, RotateCw, Square, X } from "@lucide/vue";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { InstanceStatus } from "../../shared/host-api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { act, api, state } from "../host";

const STATUS_LABEL: Record<InstanceStatus, string> = {
  loading: "Loading",
  ready: "",
  failed: "Could not load",
  unresponsive: "Not responding",
  crashed: "Stopped working",
};

const view = computed(() => state.value!);
const game = computed(() => (view.value.currentGameId ? view.value.library.games[view.value.currentGameId] : undefined));

// Module panels are native views the main process places over this area,
// so it needs to know where the area is whenever the layout changes.
const area = ref<HTMLElement | null>(null);
let observer: ResizeObserver | undefined;

function report() {
  const rect = area.value?.getBoundingClientRect();
  if (!rect) return;
  api.setWorkspaceRect({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
}

onMounted(() => {
  observer = new ResizeObserver(report);
  if (area.value) observer.observe(area.value);
  addEventListener("resize", report);
  report();
});

onBeforeUnmount(() => {
  observer?.disconnect();
  removeEventListener("resize", report);
});
</script>

<template>
  <main class="flex h-full min-w-0 flex-col" data-testid="workspace">
    <!-- Moves the window; the right padding keeps the notice clear of the
         window buttons the system draws over this corner. -->
    <header
      class="app-drag flex h-12 flex-none items-center gap-4 border-b pr-[calc(100vw-env(titlebar-area-x,0px)-env(titlebar-area-width,100vw)+1rem)] pl-4"
    >
      <h1 class="max-w-60 flex-none truncate text-lg font-semibold">{{ game?.name }}</h1>
      <div class="app-no-drag flex gap-2 overflow-x-auto" role="group" aria-label="Open a module">
        <Button
          v-for="module in view.modules"
          :key="module.id"
          size="sm"
          variant="secondary"
          :data-testid="`open-${module.id}`"
          :disabled="!module.available"
          :title="module.available ? (module.description ?? `Open ${module.name}`) : `${module.name} does not support this game`"
          @click="act({ type: 'open-module', moduleId: module.id })"
        >
          <Plus :stroke-width="1.5" /> {{ module.name }}
        </Button>
      </div>
      <span class="text-info ml-auto text-sm" role="status" data-testid="notice">{{ view.notice ?? "" }}</span>
    </header>

    <div ref="area" class="relative min-h-0 flex-1">
      <div
        v-for="panel in view.panels"
        :key="panel.instanceId"
        class="header bg-card absolute top-0 flex items-center gap-2 border-r border-b pr-1 pl-3"
        :style="{ left: `${panel.x}px`, width: `${panel.width}px`, height: `${view.panelHeaderHeight}px` }"
        :data-testid="`panel-${panel.instanceId}`"
        :data-module-id="panel.moduleId"
        :data-status="panel.status"
      >
        <span class="truncate text-sm font-medium">{{ panel.name }}</span>
        <span
          v-if="STATUS_LABEL[panel.status]"
          :class="
            cn(
              'text-muted-foreground inline-flex items-center gap-1.5 text-xs',
              (panel.status === 'failed' || panel.status === 'crashed') && 'text-destructive',
              panel.status === 'unresponsive' && 'text-info',
            )
          "
        >
          <span class="size-2 rounded-full bg-current" aria-hidden="true" />{{ STATUS_LABEL[panel.status] }}
        </span>
        <span class="ml-auto flex">
          <Button
            v-if="panel.status === 'crashed' || panel.status === 'failed'"
            variant="ghost"
            size="icon-xs"
            data-testid="reload"
            :aria-label="`Reload ${panel.name}`"
            title="Reload"
            @click="act({ type: 'reload-panel', instanceId: panel.instanceId })"
          >
            <RotateCw :stroke-width="1.5" />
          </Button>
          <Button
            v-if="panel.status === 'unresponsive'"
            variant="ghost"
            size="icon-xs"
            data-testid="stop"
            :aria-label="`Stop ${panel.name}`"
            title="Stop"
            @click="act({ type: 'stop-panel', instanceId: panel.instanceId })"
          >
            <Square :stroke-width="1.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            data-testid="close"
            :aria-label="`Close ${panel.name}`"
            title="Close"
            @click="act({ type: 'close-panel', instanceId: panel.instanceId })"
          >
            <X :stroke-width="1.5" />
          </Button>
        </span>
      </div>

      <div v-if="!view.panels.length" class="flex h-full flex-col items-center justify-center gap-1 text-center" data-testid="empty-workspace">
        <p>No modules open yet.</p>
        <p class="text-muted-foreground">Open one from the bar above. Your layout is saved for this game.</p>
      </div>
    </div>
  </main>
</template>
