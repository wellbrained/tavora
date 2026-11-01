<script setup lang="ts">
import { computed } from "vue";
import type { WorkspaceView } from "../../shared/host-api";
import { cn } from "@/lib/utils";
import type { MenuItem } from "@/host";
import { Kbd } from "@tavora/official-ui/components/ui/kbd";
import WorkspaceIcon from "./WorkspaceIcon.vue";
import MenuArea from "./menus/MenuArea.vue";
import RailTooltip from "./RailTooltip.vue";

const props = defineProps<{
  workspace: WorkspaceView;
  testid: string;
  active: boolean;
  expanded: boolean;
  menu: () => MenuItem[];
  /** Where a dragged item would land relative to this one. */
  hint?: "before" | "after" | "into" | null;
  /** The number Ctrl+1 to 9 opens it with, shown while Ctrl is held. */
  shortcut?: number | undefined;
  /** Inside an open folder: in the expanded rail it hangs off the folder's line with a smaller icon. */
  nested?: boolean;
}>();
// 40 px tiles, open or closed; inside a folder of the expanded rail a little smaller, as the folder's line indents it.
const size = computed(() => (props.expanded && props.nested ? 32 : 40));
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
      <!-- In a folder of the expanded rail the row is indented by the folder's line (WorkspaceRail.vue, ml-[22px]); the pill
           still sits on the rail's edge, not on that line. -->
      <span class="rail-pill" :style="nested && expanded ? { left: '-22px' } : undefined" aria-hidden="true" />
      <span v-if="nested && expanded" class="bg-border absolute top-1/2 left-0 h-px w-1.5" aria-hidden="true" />
      <!-- The menu opens on right-click or the menu key; the row stays lit while it is open. -->
      <RailTooltip :text="workspace.name" :disabled="expanded">
      <button
        type="button"
        :class="
          cn(
            'flex min-w-0 flex-1 items-center gap-2.5 rounded-lg text-left',
            expanded ? cn('hover:bg-rail-hover group-data-[state=open]:bg-rail-hover', nested ? 'px-1.5 py-2' : 'px-2 py-1') : 'justify-center p-1',
            expanded && active && 'bg-rail-active hover:bg-rail-active group-data-[state=open]:bg-rail-active',
            hint === 'into' && 'ring-primary ring-2 ring-inset',
          )
        "
        data-rail-item
        :data-testid="testid"
        :aria-current="active ? 'page' : undefined"
        :aria-label="workspace.name"
        @click="emit('open')"
      >
        <span class="rail-icon flex flex-none" :style="{ borderRadius: `${size / 4}px` }"><WorkspaceIcon :workspace="workspace" :size="size" /></span>
        <span v-if="expanded" :class="cn('truncate font-medium', nested ? 'text-sm' : 'text-base')">{{ workspace.name }}</span>
        <Kbd v-if="shortcut" class="text-primary ml-auto flex-none" :data-testid="`${testid}-shortcut`">{{ shortcut }}</Kbd>
      </button>
      </RailTooltip>
    </div>
  </MenuArea>
</template>
