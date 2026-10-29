<script setup lang="ts">
// A quiet marker at the bottom of the rail while a new version of Tavora is on
// its way. It never interrupts: the update installs when Tavora is closed, or
// the user presses it to restart now.
import { ArrowDownToLine, Loader, RefreshCw } from "@lucide/vue";
import { computed } from "vue";
import { cn } from "@/lib/utils";
import { act, state } from "../host";
import { t } from "../i18n";
import RailFooterTile from "./RailFooterTile.vue";
import RailTooltip from "./RailTooltip.vue";

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
  <RailTooltip v-if="visible" :text="label" :disabled="expanded">
  <button
    type="button"
    :class="
      cn(
        'text-primary mx-2 flex items-center gap-2.5 rounded-lg p-1 group-data-[expanded=true]/rail:px-2 group-data-[expanded=true]/rail:py-[9px] transition-colors focus-visible:-outline-offset-2',
        busy ? 'cursor-default opacity-80' : 'hover:bg-accent',
      )
    "
    data-rail-item
    data-testid="rail-update"
    :disabled="busy"
    :aria-label="label"
    @click="press"
  >
    <RailFooterTile :dot="busy ? undefined : 'primary'">
      <Loader v-if="update.status === 'downloading'" class="size-5 animate-spin motion-reduce:animate-none" :stroke-width="1.5" />
      <RefreshCw v-else-if="update.status === 'ready'" class="size-5" :stroke-width="1.5" />
      <ArrowDownToLine v-else class="size-5" :stroke-width="1.5" />
    </RailFooterTile>
    <span v-if="expanded" class="truncate text-sm font-medium">{{ label }}</span>
  </button>
  </RailTooltip>
</template>
