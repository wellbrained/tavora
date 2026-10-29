<script setup lang="ts">
// Right-click (or the keyboard menu key) on the wrapped element opens its menu.
import { ContextMenu, ContextMenuContent, ContextMenuLabel, ContextMenuTrigger } from "@tavora/official-ui/components/ui/context-menu";
import { computed, useTemplateRef } from "vue";
import { useFloating, type MenuItem } from "@/host";
import MenuEntries from "./MenuEntries.vue";

defineProps<{ items: () => MenuItem[]; title: string }>();
const track = useFloating();
// The menu opens beside the wrapped element, not at the pointer, wherever on it the click landed. The trigger
// renders a fragment, so its $el is the fragment's start marker and the element follows it.
const trigger = useTemplateRef<{ $el: Node }>("trigger");
const anchor = computed(() => {
  const start = trigger.value?.$el;
  return start instanceof Element ? start : nextElement(start);
});
function nextElement(node: Node | null | undefined): Element | undefined {
  for (let next = node?.nextSibling; next; next = next.nextSibling) if (next instanceof Element) return next;
  return undefined;
}
</script>

<template>
  <ContextMenu @update:open="track">
    <ContextMenuTrigger ref="trigger" as-child>
      <slot />
    </ContextMenuTrigger>
    <ContextMenuContent data-testid="menu" class="max-w-72 min-w-52" :reference="anchor">
      <ContextMenuLabel class="text-muted-foreground truncate text-xs font-normal">{{ title }}</ContextMenuLabel>
      <MenuEntries :items="items()" kind="context" />
    </ContextMenuContent>
  </ContextMenu>
</template>
