<script setup lang="ts">
import { ChevronsDownUp, ChevronsUpDown } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { collapseAll, expandAll, TreeView, type TreeNode } from "@tavora/official-ui/components/ui/tree-view";
import { ref } from "vue";

const OUTLINE: TreeNode[] = [
  { id: "start", label: "Getting started", badge: 3, children: [{ id: "install", label: "Install Tavora" }, { id: "panel", label: "Your first panel" }, { id: "layouts", label: "Layouts" }] },
  {
    id: "modules",
    label: "Modules",
    badge: 2,
    children: [
      { id: "built-in", label: "Built-in modules", children: [{ id: "notes", label: "Notes" }, { id: "todos", label: "To-dos" }, { id: "pdf", label: "PDF viewer" }] },
      { id: "own", label: "Make your own", children: [{ id: "rules", label: "The module rules" }, { id: "publish", label: "Publish to the catalog" }] },
    ],
  },
  { id: "settings", label: "Settings", children: [{ id: "look", label: "Look" }, { id: "keys", label: "Keys" }] },
];
const picked = ref("panel");
const open = ref(["start", "modules", "own"]);
</script>

<template>
  <div class="flex w-64 flex-col gap-2">
    <div class="flex gap-1.5">
      <Button size="sm" variant="outline" data-testid="tree-open-all" @click="open = expandAll(OUTLINE)"><ChevronsUpDown /> Open all</Button>
      <Button size="sm" variant="outline" data-testid="tree-close-all" @click="open = collapseAll()"><ChevronsDownUp /> Close all</Button>
    </div>
    <TreeView v-model="picked" v-model:expanded="open" :items="OUTLINE" label="Contents" data-testid="tree-outline" />
  </div>
</template>
