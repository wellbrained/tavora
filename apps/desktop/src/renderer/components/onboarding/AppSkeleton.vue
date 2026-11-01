<script setup lang="ts">
// A drawn picture of the app window for the first-run welcome: the rail with workspaces on the left, a header
// with the Add module button, and two panels. Pure CSS from the theme's colours, no screenshots. `lit` brings one
// part forward in place; `numbers` puts the callout numbers on the parts.
import { cn } from "@/lib/utils";

export type SkeletonPart = "workspace" | "panel" | "module";

const props = withDefaults(
  defineProps<{
    /** The part to light up; the others dim. Null lights none. */
    lit?: SkeletonPart | null;
    /** Parts that were walked through already. */
    seen?: SkeletonPart[];
    numbers?: boolean;
    /** A game workspace shows a coloured game tile, a personal one a plain tile. */
    kind?: "game" | "personal";
    /** The panels shown: two side by side by default. */
    panels?: number;
  }>(),
  { lit: null, seen: () => [], numbers: false, kind: "game", panels: 2 },
);

const dim = (part: SkeletonPart) => props.lit !== null && props.lit !== part;
const ring = (part: SkeletonPart) => (props.lit === part ? "ring-primary bg-primary/10 ring-2" : "");
const badge = (part: SkeletonPart) =>
  cn("absolute grid size-5 place-items-center rounded-full text-xs font-semibold", props.lit === part ? "bg-primary text-primary-foreground" : "bg-muted text-foreground");
</script>

<template>
  <div class="bg-rail relative flex h-full min-h-0 w-full overflow-hidden rounded-lg border text-[0]" aria-hidden="true" data-testid="app-skeleton" :data-lit="lit ?? 'none'">
    <!-- Rail: the workspaces -->
    <div :class="cn('flex w-[26%] flex-none flex-col gap-1.5 border-r p-1.5 transition-opacity', dim('workspace') && 'opacity-40')">
      <div :class="cn('flex flex-col gap-1.5 rounded-md p-1', ring('workspace'))">
        <div class="bg-card flex items-center gap-1.5 rounded-md p-1">
          <i :class="cn('block size-4 flex-none rounded-[5px]', kind === 'game' ? 'bg-success/70' : 'bg-info/60')" />
          <b class="bg-muted-foreground/40 block h-1.5 flex-1 rounded-full" />
        </div>
        <div class="flex items-center gap-1.5 p-1">
          <i class="bg-muted block size-4 flex-none rounded-[5px]" />
          <b class="bg-muted block h-1.5 flex-1 rounded-full" />
        </div>
        <div class="flex items-center gap-1.5 p-1">
          <i class="bg-muted block size-4 flex-none rounded-[5px]" />
          <b class="bg-muted block h-1.5 w-2/3 rounded-full" />
        </div>
      </div>
    </div>

    <!-- Main: header and panels -->
    <div class="bg-background flex min-w-0 flex-1 flex-col">
      <div class="flex h-[22%] min-h-6 flex-none items-center gap-1.5 border-b px-2">
        <i :class="cn('block size-3.5 flex-none rounded-[4px]', kind === 'game' ? 'bg-success/70' : 'bg-info/60', dim('workspace') && 'opacity-40')" />
        <b :class="cn('bg-muted-foreground/40 block h-1.5 w-1/4 rounded-full', dim('workspace') && 'opacity-40')" />
        <span :class="cn('ml-auto flex h-4 w-[26%] items-center justify-center rounded-md border border-dashed transition-opacity', ring('module'), dim('module') && 'opacity-40')">
          <b class="bg-muted-foreground/50 block h-1 w-1/2 rounded-full" />
        </span>
      </div>
      <div :class="cn('flex min-h-0 flex-1 gap-1.5 p-1.5 transition-opacity', dim('panel') && 'opacity-40')">
        <div v-for="index in panels" :key="index" :class="cn('bg-card flex min-w-0 flex-1 flex-col gap-1.5 rounded-md border p-1.5', index === 1 && ring('panel'))">
          <b class="bg-muted-foreground/40 mb-0.5 block h-1.5 w-1/3 rounded-full" />
          <s class="bg-muted block h-1 w-4/5 rounded-full no-underline" />
          <s class="bg-muted block h-1 w-full rounded-full no-underline" />
          <s class="bg-muted block h-1 w-3/5 rounded-full no-underline" />
          <s class="bg-muted block h-1 w-2/3 rounded-full no-underline" />
        </div>
      </div>
    </div>

    <template v-if="numbers">
      <span :class="badge('workspace')" style="left: 18%; top: 8%">1</span>
      <span :class="badge('panel')" style="left: 40%; top: 38%">2</span>
      <span :class="badge('module')" style="right: 20%; top: 6%">3</span>
    </template>
  </div>
</template>
