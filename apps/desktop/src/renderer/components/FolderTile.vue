<script setup lang="ts">
// A folder in the rail: a folder shape (with its tab), so it cannot be taken for a workspace, with up to four of its
// workspaces inside. The four places stay put and fill from the top left to the bottom right, so one workspace sits in
// the first place and the rest stay empty. An open folder has an
// outlined shape in the accent colour.
import { computed } from "vue";
import type { WorkspaceView } from "../../shared/host-api";
import { cn } from "@/lib/utils";
import WorkspaceIcon from "./WorkspaceIcon.vue";

const props = defineProps<{
  /** The folder's workspaces in order; only the first four are drawn. */
  workspaces: WorkspaceView[];
  /** Letters the user chose for the folder, shown instead of its workspaces. */
  label: string | null;
  open: boolean;
  /** Edge length in px; the tile is drawn at 48 and scaled, its letters kept readable. */
  size?: number;
}>();

const SLOTS = [0, 1, 2, 3];
const shown = computed(() => props.workspaces.slice(0, 4));
const zoom = computed(() => (props.size ?? 48) / 48);
// The folder's own letters never drop below the smallest type size, however small the tile.
const labelSize = computed(() => `${Math.max(13, 12 / zoom.value)}px`);
</script>

<template>
  <span class="rail-icon relative block size-12 flex-none" :style="{ zoom }" aria-hidden="true" data-testid="folder-tile">
    <svg viewBox="0 0 48 48" class="absolute inset-0 size-full overflow-visible">
      <path
        d="M1 5.5Q1 1 5 1H16Q18.5 1 19.8 3.1L21.2 5.5H43Q47 5.5 47 9.5V43Q47 47 43 47H5Q1 47 1 43Z"
        :style="{ strokeWidth: 1.25 / zoom }"
        :class="cn('fill-[color-mix(in_oklab,var(--foreground)_9%,var(--card))]', open ? 'stroke-primary' : 'stroke-foreground/35')"
        stroke-linejoin="round"
      />
    </svg>
    <span v-if="label" class="absolute inset-x-1 top-2 bottom-1 flex items-center justify-center font-semibold" :style="{ fontSize: labelSize }">{{ label }}</span>
    <span v-else class="absolute top-2 left-[5.5px] grid grid-cols-[17px_17px] grid-rows-[17px_17px] gap-[3px]">
      <template v-for="slot in SLOTS" :key="slot">
        <WorkspaceIcon v-if="shown[slot]" :workspace="shown[slot]!" :size="17" />
        <span v-else class="bg-foreground/[0.12] size-[17px] rounded-[4px]" data-testid="folder-empty-slot" />
      </template>
    </span>
  </span>
</template>
