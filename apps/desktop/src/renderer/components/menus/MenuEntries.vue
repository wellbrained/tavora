<script setup lang="ts">
// Renders a list of MenuItem as dropdown or context menu entries. The same
// lists (rail-actions.ts) back the ⋯ button and right-click.
import { Check } from "@lucide/vue";
import { computed } from "vue";
import {
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@tavora/official-ui/components/ui/context-menu";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@tavora/official-ui/components/ui/dropdown-menu";
import { state, type MenuItem } from "@/host";
import ModuleIcon from "../ModuleIcon.vue";

const props = defineProps<{ items: MenuItem[]; kind: "dropdown" | "context" }>();

const parts = computed(() =>
  props.kind === "dropdown"
    ? {
        Item: DropdownMenuItem,
        Label: DropdownMenuLabel,
        Separator: DropdownMenuSeparator,
        Sub: DropdownMenuSub,
        SubTrigger: DropdownMenuSubTrigger,
        SubContent: DropdownMenuSubContent,
      }
    : {
        Item: ContextMenuItem,
        Label: ContextMenuLabel,
        Separator: ContextMenuSeparator,
        Sub: ContextMenuSub,
        SubTrigger: ContextMenuSubTrigger,
        SubContent: ContextMenuSubContent,
      },
);

/** A list of choices keeps a column for the check mark, so labels line up whether or not one is current. */
const hasChecks = computed(() => props.items.some((item) => item.checked !== undefined));
/** Module icons follow the setting that shows them on tabs. */
const icons = computed(() => state.value?.library.moduleIcons === true);

/** Runs after the menu has closed, so a dialog it opens keeps focus. */
function run(item: MenuItem) {
  if (item.run) setTimeout(() => void item.run!(), 0);
}
</script>

<template>
  <!-- Labels can repeat, such as two modules' panel types of the same name. -->
  <template v-for="(item, index) in items" :key="`${index}:${item.label}`">
    <component :is="parts.Separator" v-if="(item.danger || item.separator) && index > 0" />
    <component :is="parts.Label" v-if="item.heading" class="flex min-w-0 items-center gap-2 pt-2 text-xs font-medium" :data-testid="item.testid">
      <ModuleIcon v-if="item.icon && icons" :module-id="item.icon.moduleId" :panel-type="item.icon.panelType" />
      <span class="truncate">{{ item.label }}</span>
    </component>
    <component :is="parts.Sub" v-else-if="item.submenu">
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
      <ModuleIcon v-if="item.icon && icons" :module-id="item.icon.moduleId" :panel-type="item.icon.panelType" />
      <span v-if="item.icon" class="min-w-0 truncate">{{ item.label }}</span>
      <template v-else>{{ item.label }}</template>
    </component>
  </template>
</template>
