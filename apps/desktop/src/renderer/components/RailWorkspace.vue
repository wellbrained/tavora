<script setup lang="ts">
import type { WorkspaceView } from "../../shared/host-api";
import { cn } from "@/lib/utils";
import type { MenuItem } from "@/host";
import { Kbd } from "@tavora/official-ui/components/ui/kbd";
import { t } from "../i18n";
import WorkspaceIcon from "./WorkspaceIcon.vue";
import MenuArea from "./menus/MenuArea.vue";
import MenuButton from "./menus/MenuButton.vue";
import RailTooltip from "./RailTooltip.vue";

defineProps<{
  workspace: WorkspaceView;
  testid: string;
  active: boolean;
  expanded: boolean;
  menu: () => MenuItem[];
  /** Where a dragged item would land relative to this one. */
  hint?: "before" | "after" | "into" | null;
  /** The number Ctrl+1 to 9 opens it with, shown while Ctrl is held. */
  shortcut?: number | undefined;
}>();
const emit = defineEmits<{ open: [] }>();
// Drag handlers from the rail go on the row, not on the menu wrapper.
defineOptions({ inheritAttrs: false });
</script>

<template>
  <MenuArea :items="menu" :title="workspace.name">
    <div
      :class="cn('group rail-entry relative flex items-center px-2', hint && `drop-${hint}`)"
      :data-active="active"
      draggable="true"
      v-bind="$attrs"
    >
      <span class="rail-pill" aria-hidden="true" />
      <RailTooltip :text="workspace.name" :disabled="expanded">
      <button
        type="button"
        :class="
          cn(
            'flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1 text-left',
            expanded && 'hover:bg-accent',
            expanded && active && 'bg-accent',
            hint === 'into' && 'ring-primary ring-2 ring-inset',
          )
        "
        data-rail-item
        :data-testid="testid"
        :aria-current="active ? 'page' : undefined"
        :aria-label="workspace.name"
        @click="emit('open')"
      >
        <span class="rail-icon flex-none rounded-[12px]"><WorkspaceIcon :workspace="workspace" :size="48" /></span>
        <span v-if="expanded" class="truncate text-sm font-medium">{{ workspace.name }}</span>
        <Kbd v-if="shortcut" class="text-primary ml-auto flex-none" :data-testid="`${testid}-shortcut`">{{ shortcut }}</Kbd>
      </button>
      </RailTooltip>
      <div
        v-if="expanded"
        class="bg-accent absolute right-4 opacity-0 group-hover:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100"
      >
        <MenuButton :items="menu" :title="workspace.name" :testid="`${testid}-menu`" :label="t('rail.moreWorkspace', { name: workspace.name })" />
      </div>
    </div>
  </MenuArea>
</template>
