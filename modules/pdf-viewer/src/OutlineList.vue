<script setup lang="ts">
// The contents list of a PDF as one flat list: entries that open their page, with the ones below them indented.
// An entry that points to no page is left out; the entries below it stay.
import { NavList, type NavGroup, type NavItem } from "@tavora/official-ui/components/ui/nav-list";
import { computed } from "vue";
import { t } from "./i18n";
import type { OutlineNode } from "./pdf";

const props = defineProps<{ nodes: OutlineNode[] }>();
const emit = defineEmits<{ go: [page: number] }>();

const pages = computed(() => {
  const map = new Map<string, number>();
  const items: NavItem[] = [];
  const walk = (nodes: OutlineNode[], level: number, path: string) =>
    nodes.forEach((node, index) => {
      const id = `${path}${index}`;
      if (node.page !== null) {
        map.set(id, node.page);
        items.push({ id, label: node.title, title: node.title, level, testid: "outline-item" });
      }
      walk(node.items, level + 1, `${id}.`);
    });
  walk(props.nodes, 0, "");
  return { map, groups: [{ items }] as NavGroup[] };
});

function pick(id: string) {
  const page = pages.value.map.get(id);
  if (page !== undefined) emit("go", page);
}
</script>

<template>
  <NavList :groups="pages.groups" :label="t('pdf.outline')" @select="pick" />
</template>
