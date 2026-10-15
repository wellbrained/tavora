<script setup lang="ts">
// The list of notes: search, the scratchpad, pinned notes, then the rest.
import { Plus, Search, X } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { computed } from "vue";
import { t } from "./i18n";
import NoteRow from "./NoteRow.vue";
import { matches, sections, type NoteEntry } from "./notes";

const props = defineProps<{ entries: Map<string, NoteEntry>; selectedId: string }>();
const emit = defineEmits<{ select: [id: string]; create: []; togglePin: [id: string]; remove: [entry: NoteEntry] }>();

const query = defineModel<string>("query", { required: true });

const grouped = computed(() => sections(props.entries.values()));
const results = computed(() => {
  if (!query.value.trim()) return null;
  const { scratchpad, pinned, others } = grouped.value;
  return [scratchpad, ...pinned, ...others].filter((entry) => matches(entry, query.value));
});

function onSearchKey(event: KeyboardEvent) {
  if (event.key === "Escape" && query.value) {
    event.stopPropagation();
    query.value = "";
  }
}
</script>

<template>
  <nav class="flex h-full min-w-0 flex-col" :aria-label="t('list.label')">
    <div class="flex h-10 flex-none items-center gap-1 border-b px-2">
      <label class="relative flex min-w-0 flex-1 items-center">
        <Search class="text-muted-foreground pointer-events-none absolute left-2 size-4" :stroke-width="1.5" aria-hidden="true" />
        <input
          v-model="query"
          type="search"
          data-testid="search"
          :placeholder="t('list.search')"
          :aria-label="t('list.search')"
          class="placeholder:text-muted-foreground focus-visible:border-ring h-7 w-full min-w-0 rounded-md border border-transparent bg-transparent pr-7 pl-7 text-sm outline-none"
          @keydown="onSearchKey"
        />
        <button
          v-if="query"
          type="button"
          class="text-muted-foreground hover:text-foreground absolute right-1 rounded-sm p-1"
          :aria-label="t('list.clearSearch')"
          :title="t('list.clearSearch')"
          @click="query = ''"
        >
          <X class="size-3.5" :stroke-width="1.5" />
        </button>
      </label>
      <Button variant="ghost" size="icon-sm" class="flex-none" data-testid="new-note" :aria-label="t('list.new')" :title="t('list.new')" @click="emit('create')">
        <Plus :stroke-width="1.5" />
      </Button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto p-1">
      <template v-if="results">
        <p v-if="!results.length" class="text-muted-foreground px-3 py-6 text-center text-sm" data-testid="no-results">{{ t("list.none", { query: query.trim() }) }}</p>
        <ul v-else role="list" data-testid="results">
          <li v-for="entry in results" :key="entry.id">
            <NoteRow :entry="entry" :selected="entry.id === selectedId" @select="emit('select', entry.id)" @toggle-pin="emit('togglePin', entry.id)" @remove="emit('remove', entry)" />
          </li>
        </ul>
      </template>
      <template v-else>
        <ul role="list">
          <li><NoteRow :entry="grouped.scratchpad" :selected="grouped.scratchpad.id === selectedId" @select="emit('select', grouped.scratchpad.id)" @toggle-pin="emit('togglePin', grouped.scratchpad.id)" @remove="emit('remove', grouped.scratchpad)" /></li>
        </ul>
        <template v-if="grouped.pinned.length">
          <h2 class="text-muted-foreground px-3 pt-3 pb-1 text-xs font-medium">{{ t("list.pinned") }}</h2>
          <ul role="list" data-testid="pinned">
            <li v-for="entry in grouped.pinned" :key="entry.id"><NoteRow :entry="entry" :selected="entry.id === selectedId" @select="emit('select', entry.id)" @toggle-pin="emit('togglePin', entry.id)" @remove="emit('remove', entry)" /></li>
          </ul>
        </template>
        <h2 v-if="grouped.others.length" class="text-muted-foreground px-3 pt-3 pb-1 text-xs font-medium">{{ t("list.label") }}</h2>
        <ul role="list" data-testid="notes">
          <li v-for="entry in grouped.others" :key="entry.id"><NoteRow :entry="entry" :selected="entry.id === selectedId" @select="emit('select', entry.id)" @toggle-pin="emit('togglePin', entry.id)" @remove="emit('remove', entry)" /></li>
        </ul>
        <div v-if="!grouped.pinned.length && !grouped.others.length" class="px-3 py-6 text-center">
          <p class="text-muted-foreground text-sm">{{ t("list.empty") }}</p>
          <Button variant="secondary" size="sm" class="mt-3" @click="emit('create')"><Plus :stroke-width="1.5" /> {{ t("list.new") }}</Button>
        </div>
      </template>
    </div>
  </nav>

</template>
