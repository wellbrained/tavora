<script setup lang="ts">
import { computed } from "vue";
import type { WorkspaceView } from "../../shared/host-api";
import { cn } from "@/lib/utils";
import type { MenuItem } from "@/host";
import { Kbd } from "@tavora/official-ui/components/ui/kbd";
import { t } from "../i18n";
import WorkspaceIcon from "./WorkspaceIcon.vue";
import MenuArea from "./menus/MenuArea.vue";
import MenuButton from "./menus/MenuButton.vue";
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
// Compact: 40 px tiles. Expanded: a list with small icons, smaller still inside a folder.
const size = computed(() => (props.expanded ? (props.nested ? 24 : 30) : 40));
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
      <span v-if="nested && expanded" class="bg-border absolute top-1/2 left-0 h-px w-2" aria-hidden="true" />
      <RailTooltip :text="workspace.name" :disabled="expanded">
      <button
        type="button"
        :class="
          cn(
            'flex min-w-0 flex-1 items-center gap-2.5 rounded-lg text-left',
            expanded ? 'hover:bg-accent px-2 py-1' : 'justify-center p-1',
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
        <span class="rail-icon flex-none" :style="{ borderRadius: `${size / 4}px` }"><WorkspaceIcon :workspace="workspace" :size="size" /></span>
        <span v-if="expanded" :class="cn('truncate font-medium', nested ? 'text-sm' : 'text-base')">{{ workspace.name }}</span>
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
