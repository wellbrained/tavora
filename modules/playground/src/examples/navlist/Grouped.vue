<script setup lang="ts">
import { Blocks, LayoutGrid, Store } from "@lucide/vue";
import { NavList, type NavGroup } from "@tavora/official-ui/components/ui/nav-list";
import { ref } from "vue";

const GROUPS: NavGroup[] = [
  { heading: "Installed", items: [{ id: "all", label: "All", icon: Blocks, badge: 12 }, { id: "workspace", label: "In this workspace", icon: LayoutGrid, badge: 3 }] },
  { heading: "More", items: [{ id: "catalog", label: "Catalog", icon: Store }, { id: "featured", label: "Featured", level: 1 }, { id: "recent", label: "Recent", level: 2 }] },
];
const selected = ref("all");
</script>

<template>
  <NavList v-model="selected" class="w-56" label="Categories" :groups="GROUPS" />
</template>
