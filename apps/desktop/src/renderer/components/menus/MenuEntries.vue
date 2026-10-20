<script setup lang="ts">
// Renders a list of MenuItem as dropdown or context menu entries. The same
// lists (rail-actions.ts) back the ⋯ button and right-click.
import { Check } from "@lucide/vue";
import { computed } from "vue";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@tavora/official-ui/components/ui/context-menu";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@tavora/official-ui/components/ui/dropdown-menu";
import type { MenuItem } from "@/host";

const props = defineProps<{ items: MenuItem[]; kind: "dropdown" | "context" }>();

const parts = computed(() =>
  props.kind === "dropdown"
    ? {
        Item: DropdownMenuItem,
        Separator: DropdownMenuSeparator,
        Sub: DropdownMenuSub,
        SubTrigger: DropdownMenuSubTrigger,
        SubContent: DropdownMenuSubContent,
      }
    : {
        Item: ContextMenuItem,
        Separator: ContextMenuSeparator,
        Sub: ContextMenuSub,
        SubTrigger: ContextMenuSubTrigger,
        SubContent: ContextMenuSubContent,
      },
);

/** A list of choices keeps a column for the check mark, so labels line up whether or not one is current. */
const hasChecks = computed(() => props.items.some((item) => item.checked !== undefined));

/** Runs after the menu has closed, so a dialog it opens keeps focus. */
function run(item: MenuItem) {
  if (item.run) setTimeout(() => void item.run!(), 0);
}
</script>

<template>
  <template v-for="(item, index) in items" :key="item.label">
    <component :is="parts.Separator" v-if="(item.danger || item.separator) && index > 0" />
    <component :is="parts.Sub" v-if="item.submenu">
      <component :is="parts.SubTrigger" :data-testid="item.testid" :disabled="item.disabled">{{ item.label }}</component>
      <component :is="parts.SubContent" class="max-w-72 min-w-48">
        <MenuEntries :items="item.submenu()" :kind="kind" />
      </component>
    </component>
    <component
      :is="parts.Item"
      v-else
      :data-testid="item.testid"
      :disabled="item.disabled"
      :variant="item.danger ? 'destructive' : 'default'"
      :aria-checked="item.checked === undefined ? undefined : item.checked"
      :role="item.checked === undefined ? undefined : 'menuitemradio'"
      :data-checked="item.checked || undefined"
      @select="run(item)"
    >
      <span v-if="hasChecks" class="inline-flex size-4 flex-none items-center justify-center" aria-hidden="true">
        <Check v-if="item.checked" class="size-4" />
      </span>
      {{ item.label }}
    </component>
  </template>
</template>
