<script setup lang="ts">
// The list of notes: search, the scratchpad, pinned notes, then the rest.
import { NotebookPen, PanelLeftClose, PanelLeftOpen, Pin, Plus, Search, X } from "@lucide/vue";
import { cn } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import { computed, nextTick, ref } from "vue";
import { t } from "./i18n";
import NoteRow from "./NoteRow.vue";
import { matches, SCRATCHPAD_ID, sections, UNTITLED, type NoteEntry } from "./notes";

const props = defineProps<{ entries: Map<string, NoteEntry>; order: string[]; selectedId: string; collapsed: boolean; narrow: boolean }>();
const emit = defineEmits<{
  select: [id: string];
  create: [];
  togglePin: [id: string];
  remove: [entry: NoteEntry];
  rename: [id: string, title: string];
  reorder: [id: string, target: string, after: boolean];
  move: [id: string, delta: -1 | 1];
  toggleCollapsed: [];
}>();

const query = defineModel<string>("query", { required: true });

const grouped = computed(() => sections(props.entries.values(), props.order));
const results = computed(() => {
  if (!query.value.trim()) return null;
  const { scratchpad, pinned, others } = grouped.value;
  return [scratchpad, ...pinned, ...others].filter((entry) => matches(entry, query.value));
});

// Notes can be put in a different order by dragging, or with Alt+Up and Alt+Down; only within pinned or within the rest.
const renamingId = ref<string | null>(null);
const dragId = ref<string | null>(null);
const drop = ref<{ id: string; after: boolean } | null>(null);

function onDragStart(event: DragEvent, entry: NoteEntry) {
  dragId.value = entry.id;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", entry.title);
  }
}

function onDragOver(event: DragEvent, entry: NoteEntry) {
  const from = dragId.value ? props.entries.get(dragId.value) : undefined;
  if (!from || from.id === entry.id || from.pinned !== entry.pinned) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  drop.value = { id: entry.id, after: event.clientY > rect.top + rect.height / 2 };
}

function onDrop(event: DragEvent) {
  event.preventDefault();
  if (dragId.value && drop.value) emit("reorder", dragId.value, drop.value.id, drop.value.after);
  endDrag();
}

function endDrag() {
  dragId.value = null;
  drop.value = null;
}

async function onMove(id: string, delta: -1 | 1) {
  emit("move", id, delta);
  // The row is moved in the list, which drops keyboard focus; give it back.
  await nextTick();
  setTimeout(() => document.querySelector<HTMLElement>(`[data-testid="note-${id}"] button`)?.focus(), 60);
}

function dropShadow(entry: NoteEntry): string | false {
  return drop.value?.id === entry.id && (drop.value.after ? "shadow-[0_2px_0_0_var(--primary)]" : "shadow-[0_-2px_0_0_var(--primary)]");
}

/** The collapsed strip: the scratchpad, pinned notes, then the rest, each as a small icon. */
const railNotes = computed(() => {
  const { scratchpad, pinned, others } = grouped.value;
  return [scratchpad, ...pinned, ...others];
});

/** The first letter or digit of a note's title, or null for a title without one. */
function initialOf(entry: NoteEntry): string | null {
  const first = Array.from(entry.title === UNTITLED ? "" : entry.title).find((char) => /[\p{L}\p{N}]/u.test(char));
  return first ? first.toLocaleUpperCase() : null;
}

function railTitle(entry: NoteEntry): string {
  return entry.id === SCRATCHPAD_ID ? t("scratchpad") : entry.title === UNTITLED ? t("untitled") : entry.title;
}

function onSearchKey(event: KeyboardEvent) {
  if (event.key === "Escape" && query.value) {
    event.stopPropagation();
    query.value = "";
  }
}
</script>

<template>
  <nav v-if="collapsed && !narrow" class="flex h-full min-w-0 flex-col items-center" :aria-label="t('list.label')" data-testid="notes-rail">
    <div class="border-primary/25 bg-primary/5 flex h-10 w-full flex-none items-center justify-center border-b">
      <Button variant="ghost" size="icon-sm" data-testid="expand-sidebar" :aria-label="t('list.expand')" :title="t('list.expand')" @click="emit('toggleCollapsed')">
        <PanelLeftOpen :stroke-width="1.5" />
      </Button>
    </div>
    <Button variant="ghost" size="icon-sm" class="mt-2 flex-none" data-testid="new-note" :aria-label="t('list.new')" :title="t('list.new')" @click="emit('create')">
      <Plus :stroke-width="1.5" />
    </Button>
    <ul role="list" class="mt-2 flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-y-auto p-1.5">
      <li v-for="entry in railNotes" :key="entry.id">
        <button
          type="button"
          :class="cn('hover:bg-accent relative flex size-8 items-center justify-center rounded-md', entry.id === selectedId && 'bg-accent ring-primary ring-1')"
          :aria-label="railTitle(entry)"
          :aria-current="entry.id === selectedId ? 'true' : undefined"
          :title="railTitle(entry)"
          :data-testid="`rail-${entry.id}`"
          @click="emit('select', entry.id)"
        >
          <NotebookPen v-if="entry.id === SCRATCHPAD_ID" class="text-primary size-4" :stroke-width="1.5" aria-hidden="true" />
          <span
            v-else
            :class="cn('flex size-6 items-center justify-center rounded-md text-xs font-semibold', entry.pinned ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground')"
            aria-hidden="true"
          >{{ initialOf(entry) ?? "·" }}</span>
          <Pin v-if="entry.pinned" class="text-primary absolute top-0.5 right-0.5 size-2.5 fill-current" :stroke-width="1.5" aria-hidden="true" />
        </button>
      </li>
    </ul>
  </nav>
  <nav v-else class="flex h-full min-w-0 flex-col" :aria-label="t('list.label')">
    <div class="border-primary/25 bg-primary/5 flex h-10 flex-none items-center gap-1 border-b px-2">
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
      <Button v-if="!narrow" variant="ghost" size="icon-sm" class="flex-none" data-testid="collapse-sidebar" :aria-label="t('list.collapse')" :title="t('list.collapse')" @click="emit('toggleCollapsed')">
        <PanelLeftClose :stroke-width="1.5" />
      </Button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto p-1">
      <template v-if="results">
        <p v-if="!results.length" class="text-muted-foreground px-3 py-6 text-center text-sm" data-testid="no-results">{{ t("list.none", { query: query.trim() }) }}</p>
        <ul v-else role="list" data-testid="results">
          <li v-for="entry in results" :key="entry.id">
            <NoteRow :entry="entry" :selected="entry.id === selectedId" @select="emit('select', entry.id)" @toggle-pin="emit('togglePin', entry.id)" @remove="emit('remove', entry)" @rename="(title) => emit('rename', entry.id, title)" />
          </li>
        </ul>
      </template>
      <template v-else>
        <ul role="list">
          <li><NoteRow :entry="grouped.scratchpad" :selected="grouped.scratchpad.id === selectedId" @select="emit('select', grouped.scratchpad.id)" @toggle-pin="emit('togglePin', grouped.scratchpad.id)" @remove="emit('remove', grouped.scratchpad)" @rename="(title) => emit('rename', grouped.scratchpad.id, title)" /></li>
        </ul>
        <template v-if="grouped.pinned.length">
          <h2 class="text-primary px-3 pt-3 pb-1 text-xs font-semibold">{{ t("list.pinned") }}</h2>
          <ul role="list" data-testid="pinned">
            <li
              v-for="entry in grouped.pinned"
              :key="entry.id"
              :draggable="renamingId !== entry.id"
              :class="cn(dragId === entry.id && 'opacity-50', dropShadow(entry))"
              @dragstart="onDragStart($event, entry)"
              @dragover="onDragOver($event, entry)"
              @drop="onDrop"
              @dragend="endDrag"
            >
              <NoteRow :entry="entry" :selected="entry.id === selectedId" @select="emit('select', entry.id)" @toggle-pin="emit('togglePin', entry.id)" @remove="emit('remove', entry)" @rename="(title) => emit('rename', entry.id, title)" @move="(delta) => onMove(entry.id, delta)" @renaming="(on) => (renamingId = on ? entry.id : null)" />
            </li>
          </ul>
        </template>
        <h2 v-if="grouped.others.length" class="text-primary px-3 pt-3 pb-1 text-xs font-semibold">{{ t("list.label") }}</h2>
        <ul role="list" data-testid="notes">
          <li
            v-for="entry in grouped.others"
            :key="entry.id"
            :draggable="renamingId !== entry.id"
            :class="cn(dragId === entry.id && 'opacity-50', dropShadow(entry))"
            @dragstart="onDragStart($event, entry)"
            @dragover="onDragOver($event, entry)"
            @drop="onDrop"
            @dragend="endDrag"
          >
            <NoteRow :entry="entry" :selected="entry.id === selectedId" @select="emit('select', entry.id)" @toggle-pin="emit('togglePin', entry.id)" @remove="emit('remove', entry)" @rename="(title) => emit('rename', entry.id, title)" @move="(delta) => onMove(entry.id, delta)" @renaming="(on) => (renamingId = on ? entry.id : null)" />
          </li>
        </ul>
        <div v-if="!grouped.pinned.length && !grouped.others.length" class="px-3 py-6 text-center">
          <p class="text-muted-foreground text-sm">{{ t("list.empty") }}</p>
          <Button variant="secondary" size="sm" class="mt-3" @click="emit('create')"><Plus :stroke-width="1.5" /> {{ t("list.new") }}</Button>
        </div>
      </template>
    </div>
  </nav>

</template>
