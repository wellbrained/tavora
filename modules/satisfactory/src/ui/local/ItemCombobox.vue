<script setup lang="ts">
// LOCAL CONTROL: the kit has no combobox yet, so this is the simplest one that
// works: the kit's Input with a list of matching items under it. Arrow keys
// move, Enter picks, Escape closes. Kept on its own so the kit can replace it.
import { Search } from "@lucide/vue";
import { Input } from "@tavora/official-ui/components/ui/input";
import { computed, ref, useId } from "vue";
import { language, t } from "../../i18n";
import GameIcon from "../common/GameIcon.vue";
import { useModule } from "../context";
import { search } from "../search";

const props = defineProps<{ label: string; filter?: (item: string) => boolean }>();
const emit = defineEmits<{ pick: [item: string] }>();

const { services } = useModule();
const query = ref("");
const open = ref(false);
const active = ref(0);
const listId = useId();

const hits = computed(() =>
  query.value.trim()
    ? search(services.data, query.value, language.value, { kinds: ["item"], limit: 12, filter: (entry) => !props.filter || props.filter(entry.id) })
    : [],
);

function onInput() {
  open.value = true;
  active.value = 0;
}

function pick(index: number) {
  const hit = hits.value[index];
  if (!hit) return;
  emit("pick", hit.id);
  query.value = "";
  open.value = false;
}

function onKey(event: KeyboardEvent) {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    open.value = true;
    const count = hits.value.length;
    if (count) active.value = (active.value + (event.key === "ArrowDown" ? 1 : count - 1)) % count;
  } else if (event.key === "Enter") {
    event.preventDefault();
    pick(active.value);
  } else if (event.key === "Escape" && open.value) {
    event.preventDefault();
    event.stopPropagation();
    open.value = false;
  }
}
</script>

<template>
  <div class="relative">
    <Search class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" :stroke-width="1.5" />
    <Input
      v-model="query"
      class="pl-8"
      role="combobox"
      autocomplete="off"
      spellcheck="false"
      :placeholder="label"
      :aria-label="label"
      :aria-expanded="open && hits.length > 0"
      :aria-controls="listId"
      :aria-activedescendant="open && hits[active] ? `${listId}-${active}` : undefined"
      data-testid="item-search"
      @input="onInput"
      @keydown="onKey"
      @focus="open = true"
      @blur="open = false"
    />
    <ul
      v-show="open && query.trim()"
      :id="listId"
      role="listbox"
      :aria-label="label"
      class="bg-popover text-popover-foreground absolute top-full right-0 left-0 z-30 mt-1 max-h-64 overflow-y-auto rounded-md border p-1 shadow-md"
    >
      <li
        v-for="(hit, index) in hits"
        :id="`${listId}-${index}`"
        :key="hit.id"
        role="option"
        :aria-selected="index === active"
        class="flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm"
        :class="index === active ? 'bg-accent text-accent-foreground' : ''"
        data-testid="item-option"
        @mousedown.prevent="pick(index)"
        @mouseenter="active = index"
      >
        <GameIcon :icon="services.data.items[hit.id]?.icon" :size="20" />
        <span class="min-w-0 truncate">{{ hit.name }}</span>
      </li>
      <li v-if="!hits.length" class="text-muted-foreground px-2 py-1.5 text-sm">{{ t("search.noItems") }}</li>
    </ul>
  </div>
</template>
