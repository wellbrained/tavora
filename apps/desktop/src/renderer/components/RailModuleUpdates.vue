<script setup lang="ts">
// In the rail above the profile, only while module updates wait: the count, and a way to the module library's Updates view.
// The app's own update has its marker (UpdateMarker.vue).
import { CloudDownload } from "@lucide/vue";
import { computed } from "vue";
import { cn } from "@/lib/utils";
import { dialog, state } from "../host";
import { t } from "../i18n";
import RailFooterTile from "./RailFooterTile.vue";
import RailTooltip from "./RailTooltip.vue";

defineProps<{ expanded: boolean }>();

const count = computed(() => state.value!.modules.filter((module) => module.update).length);
</script>

<template>
  <RailTooltip v-if="count" :text="t('workspace.updates', { count })" :hint="t('workspace.updates.title')" :disabled="expanded">
    <button
      type="button"
      :class="cn('group text-muted-foreground hover:text-foreground mx-2 flex items-center gap-2.5 rounded-lg p-1 group-data-[expanded=true]/rail:px-2 transition-colors focus-visible:-outline-offset-2', expanded && 'hover:bg-accent')"
      data-rail-item
      data-testid="module-updates-button"
      :aria-label="t('workspace.updates', { count })"
      @click="dialog = { kind: 'add-module', view: 'updates' }"
    >
      <RailFooterTile dot="primary">
        <CloudDownload class="size-5" :stroke-width="1.5" />
      </RailFooterTile>
      <span v-if="expanded" class="truncate text-sm font-medium">{{ t("workspace.updates", { count }) }}</span>
    </button>
  </RailTooltip>
</template>
