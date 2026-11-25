<script setup lang="ts">
import { Box, Pickaxe } from "@lucide/vue";
import { TreeView, type TreeNode } from "@tavora/official-ui/components/ui/tree-view";

// What each part needs, per minute; the row slot draws the rate and the machine beside the name.
interface Step extends TreeNode {
  rate: string;
  made?: string;
  children?: Step[];
}
const CHAIN: Step[] = [
  {
    id: "frame",
    label: "Modular frame",
    rate: "10/min",
    made: "Assembler × 5",
    children: [
      { id: "plate", label: "Reinforced iron plate", rate: "15/min", made: "Assembler × 3", children: [{ id: "iron", label: "Iron plate", rate: "90/min", made: "Constructor × 4.5", children: [{ id: "ore", label: "Iron ore", rate: "135/min" }] }] },
      { id: "rod", label: "Iron rod", rate: "60/min", made: "Constructor × 4", children: [{ id: "ore-2", label: "Iron ore", rate: "60/min" }] },
    ],
  },
];
</script>

<template>
  <TreeView :items="CHAIN" selection="none" default-expanded="all" label="Production chain" class="max-w-md" data-testid="tree-chain">
    <template #row="{ item, branch }">
      <component :is="branch ? Box : Pickaxe" class="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
      <span class="text-foreground min-w-0 truncate">{{ item.label }}</span>
      <span class="text-muted-foreground shrink-0 text-xs tabular-nums">{{ item.rate }}</span>
      <span v-if="item.made" class="text-muted-foreground ml-auto shrink-0 truncate text-xs font-normal">{{ item.made }}</span>
    </template>
  </TreeView>
</template>
