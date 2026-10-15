<script setup lang="ts">
// A quiet marker at the bottom of the rail while a new version of Tavora is on
// its way. It never interrupts: the update installs when Tavora is closed, or
// the player presses it to restart now.
import { ArrowDownToLine, Loader, RefreshCw } from "@lucide/vue";
import { computed } from "vue";
import { cn } from "@/lib/utils";
import { act, state } from "../host";
import { t } from "../i18n";

defineProps<{ expanded: boolean }>();

const update = computed(() => state.value!.update);
// Only a version that was found shows up here; a check in progress or an idle one is not shown.
const visible = computed(() => !["idle", "checking"].includes(update.value.status));

const label = computed(() => {
  const u = update.value;
  if (u.status === "ready") return t("update.marker.ready", { version: u.version });
  if (u.status === "available") return t("update.marker.available", { version: u.version });
  if (u.status === "downloading") return t("update.marker.downloading", { version: u.version });
  return "";
});

const busy = computed(() => update.value.status === "downloading");

function press() {
  if (update.value.status === "ready") void act({ type: "restart-to-update" });
  else if (update.value.status === "available") void act({ type: "download-update" });
}
</script>

<template>
  <button
    v-if="visible"
    type="button"
    :class="
      cn(
        'text-primary mx-2 flex h-10 items-center gap-3 rounded-lg px-1 transition-colors',
        busy ? 'cursor-default opacity-80' : 'hover:bg-accent',
      )
    "
    data-rail-item
    data-testid="rail-update"
    :disabled="busy"
    :aria-label="label"
    :title="label"
    @click="press"
  >
    <!-- Same 48 px slot as the other bottom items, so the icon stays on the tiles' centre line. -->
    <span class="flex w-12 flex-none justify-center">
      <Loader v-if="update.status === 'downloading'" class="size-5 animate-spin motion-reduce:animate-none" :stroke-width="1.5" />
      <RefreshCw v-else-if="update.status === 'ready'" class="size-5" :stroke-width="1.5" />
      <ArrowDownToLine v-else class="size-5" :stroke-width="1.5" />
    </span>
    <span v-if="expanded" class="truncate text-sm font-medium">{{ label }}</span>
  </button>
</template>
