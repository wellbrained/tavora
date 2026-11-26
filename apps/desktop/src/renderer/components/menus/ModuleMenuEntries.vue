<script setup lang="ts">
// The entries of a module's menu (ui.showMenu), as the main process checked them: text only, a
// colour dot when the module gave a CSS colour, a check for ticked entries and the kit's radio look for single choices, a hint on the right.
import { Check } from "@lucide/vue";
import { computed } from "vue";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@tavora/official-ui/components/ui/dropdown-menu";
import type { ModuleMenuEntry } from "../../../shared/host-api";

const props = defineProps<{ entries: ModuleMenuEntry[]; prefix?: string }>();
const emit = defineEmits<{ choose: [id: string] }>();

/** A list of choices keeps a column for the mark, so labels line up whether or not one is current. */
const hasMarks = computed(() => props.entries.some((entry) => entry.type === "item" && entry.checked !== undefined && !entry.radio));

/** A run of single-choice entries is one radio group of the kit, which shows the current one by its fill. */
type Item = Extract<ModuleMenuEntry, { type: "item" }>;
type Row = { key: string; entry: ModuleMenuEntry; index: number } | { key: string; choices: { entry: Item; index: number }[]; current: string };
const rows = computed<Row[]>(() => {
  const out: Row[] = [];
  props.entries.forEach((entry, index) => {
    const key = `${entry.type}-${index}`;
    if (entry.type !== "item" || entry.checked === undefined || !entry.radio) return void out.push({ key, entry, index });
    const last = out.at(-1);
    if (last && "choices" in last) {
      last.choices.push({ entry, index });
      if (entry.checked) last.current = entry.id;
    } else out.push({ key, choices: [{ entry, index }], current: entry.checked ? entry.id : "" });
  });
  return out;
});
</script>

<template>
  <template v-for="row in rows" :key="row.key">
    <DropdownMenuRadioGroup v-if="'choices' in row" :model-value="row.current">
      <DropdownMenuRadioItem
        v-for="choice in row.choices"
        :key="choice.index"
        :value="choice.entry.id"
        :disabled="choice.entry.disabled"
        :data-testid="`module-menu-item-${choice.entry.id}`"
        @select="emit('choose', choice.entry.id)"
      >
        <span v-if="choice.entry.color" class="size-3 flex-none rounded-full border" :style="{ background: choice.entry.color }" aria-hidden="true" />
        <span class="min-w-0 truncate">{{ choice.entry.label }}</span>
        <DropdownMenuShortcut v-if="choice.entry.hint" class="tracking-normal">{{ choice.entry.hint }}</DropdownMenuShortcut>
      </DropdownMenuRadioItem>
    </DropdownMenuRadioGroup>
    <template v-else>
    <template v-for="entry in [row.entry]" :key="entry.type">
    <DropdownMenuSeparator v-if="entry.type === 'separator'" />
    <DropdownMenuLabel v-else-if="entry.type === 'heading'" class="text-muted-foreground truncate text-xs font-normal">{{ entry.label }}</DropdownMenuLabel>
    <DropdownMenuSub v-else-if="entry.type === 'submenu'">
      <DropdownMenuSubTrigger :disabled="entry.disabled" :data-testid="`module-menu-sub-${prefix ?? ''}${row.index}`">
        <span v-if="entry.color" class="size-3 flex-none rounded-full border" :style="{ background: entry.color }" aria-hidden="true" />
        <span class="min-w-0 truncate">{{ entry.label }}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent class="max-w-72 min-w-44">
        <ModuleMenuEntries :entries="entry.items" :prefix="`${prefix ?? ''}${row.index}-`" @choose="emit('choose', $event)" />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
    <DropdownMenuItem
      v-else
      :disabled="entry.disabled"
      :variant="entry.danger ? 'destructive' : 'default'"
      :role="entry.checked === undefined ? undefined : 'menuitemcheckbox'"
      :aria-checked="entry.checked"
      :data-testid="`module-menu-item-${entry.id}`"
      @select="emit('choose', entry.id)"
    >
      <span v-if="hasMarks" class="inline-flex size-4 flex-none items-center justify-center" aria-hidden="true">
        <Check v-if="entry.checked" class="size-4" />
      </span>
      <span v-if="entry.color" class="size-3 flex-none rounded-full border" :style="{ background: entry.color }" aria-hidden="true" />
      <span class="min-w-0 truncate">{{ entry.label }}</span>
      <DropdownMenuShortcut v-if="entry.hint" class="tracking-normal">{{ entry.hint }}</DropdownMenuShortcut>
    </DropdownMenuItem>
    </template>
    </template>
  </template>
</template>
