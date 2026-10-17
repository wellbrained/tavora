<script setup lang="ts">
// The entries of a module's menu (ui.showMenu), as the main process checked them: text only, a
// colour dot when the module gave a CSS colour, a check or dot for choices, a hint on the right.
import { Check, Circle } from "@lucide/vue";
import { computed } from "vue";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import type { ModuleMenuEntry } from "../../../shared/host-api";

const props = defineProps<{ entries: ModuleMenuEntry[]; prefix?: string }>();
const emit = defineEmits<{ choose: [id: string] }>();

/** A list of choices keeps a column for the mark, so labels line up whether or not one is current. */
const hasMarks = computed(() => props.entries.some((entry) => entry.type === "item" && entry.checked !== undefined));
</script>

<template>
  <template v-for="(entry, index) in entries" :key="`${entry.type}-${index}`">
    <DropdownMenuSeparator v-if="entry.type === 'separator'" />
    <DropdownMenuLabel v-else-if="entry.type === 'heading'" class="text-muted-foreground truncate text-xs font-normal">{{ entry.label }}</DropdownMenuLabel>
    <DropdownMenuSub v-else-if="entry.type === 'submenu'">
      <DropdownMenuSubTrigger :disabled="entry.disabled" :data-testid="`module-menu-sub-${prefix ?? ''}${index}`">
        <span v-if="entry.color" class="size-3 flex-none rounded-full border" :style="{ background: entry.color }" aria-hidden="true" />
        <span class="min-w-0 truncate">{{ entry.label }}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent class="max-w-72 min-w-44">
        <ModuleMenuEntries :entries="entry.items" :prefix="`${prefix ?? ''}${index}-`" @choose="emit('choose', $event)" />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
    <DropdownMenuItem
      v-else
      :disabled="entry.disabled"
      :variant="entry.danger ? 'destructive' : 'default'"
      :role="entry.checked === undefined ? undefined : entry.radio ? 'menuitemradio' : 'menuitemcheckbox'"
      :aria-checked="entry.checked"
      :data-testid="`module-menu-item-${entry.id}`"
      @select="emit('choose', entry.id)"
    >
      <span v-if="hasMarks" class="inline-flex size-4 flex-none items-center justify-center" aria-hidden="true">
        <template v-if="entry.checked">
          <Circle v-if="entry.radio" class="size-2 fill-current" />
          <Check v-else class="size-4" />
        </template>
      </span>
      <span v-if="entry.color" class="size-3 flex-none rounded-full border" :style="{ background: entry.color }" aria-hidden="true" />
      <span class="min-w-0 truncate">{{ entry.label }}</span>
      <DropdownMenuShortcut v-if="entry.hint" class="tracking-normal">{{ entry.hint }}</DropdownMenuShortcut>
    </DropdownMenuItem>
  </template>
</template>
