<script setup lang="ts">
import { Input } from "@tavora/official-ui/components/ui/input";
import { PaletteItem, PaletteList } from "@tavora/official-ui/components/ui/palette";
import { Popover, PopoverAnchor, PopoverContent } from "@tavora/official-ui/components/ui/popover";
import { computed, ref, useId } from "vue";

const WORDS = ["Waystone", "Wayfarer", "Wayside", "Watchtower", "Wellspring", "Wildwood"];

const text = ref("Wa");
const box = ref<HTMLElement | null>(null);
const listId = useId();
const shut = ref(false);
const highlighted = ref(0);

const matches = computed(() => (text.value ? WORDS.filter((word) => word.toLowerCase().startsWith(text.value.toLowerCase()) && word !== text.value) : []));
const open = computed(() => matches.value.length > 0 && !shut.value);
const activeId = computed(() => (open.value ? `${listId}-${highlighted.value}` : undefined));

function type(value: string | number) {
  text.value = String(value);
  shut.value = false;
  highlighted.value = 0;
}

function pick(word: string) {
  text.value = word;
  shut.value = true;
}

function onKey(event: KeyboardEvent) {
  if (!open.value) return;
  const count = matches.value.length;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") highlighted.value = (highlighted.value + (event.key === "ArrowDown" ? 1 : -1) + count) % count;
  else if (event.key === "Enter") pick(matches.value[highlighted.value]!);
  else if (event.key === "Escape") shut.value = true;
  else return;
  event.preventDefault();
}
</script>

<template>
  <Popover :open="open" @update:open="(next) => !next && (shut = true)">
    <div ref="box" class="w-56">
      <PopoverAnchor as-child>
        <Input
          :model-value="text"
          role="combobox"
          aria-label="Name"
          aria-autocomplete="list"
          :aria-expanded="open"
          :aria-controls="listId"
          :aria-activedescendant="activeId"
          @update:model-value="type"
          @keydown="onKey"
        />
      </PopoverAnchor>
    </div>
    <PopoverContent focus="none" align="start" :dismiss-ignore="box" class="w-56 p-0">
      <PaletteList :id="listId" label="Names" class="p-1">
        <PaletteItem v-for="(word, index) in matches" :id="`${listId}-${index}`" :key="word" size="default" :active="index === highlighted" @click="pick(word)">
          {{ word }}
        </PaletteItem>
      </PaletteList>
    </PopoverContent>
  </Popover>
</template>
