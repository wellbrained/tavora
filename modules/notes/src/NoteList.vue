<script setup lang="ts">
// The list of notes: search, the scratchpad, pinned notes, then the rest.
import { NotebookPen, PanelLeftClose, PanelLeftOpen, Pin, Plus } from "@lucide/vue";
import { cn, useFocusRecovery } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import { EmptyState } from "@tavora/official-ui/components/ui/empty-state";
import { liftedDragImage, reducedMotion, useReorderMotion } from "@tavora/official-ui/components/ui/reorder";
import { SearchInput } from "@tavora/official-ui/components/ui/search-input";
import { Toolbar } from "@tavora/official-ui/components/ui/toolbar";
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

// A deleted note hands the focus to the next one (or the one before, or the search when no result is left), never to
// the page; Undo gives it back.
const root = ref<HTMLElement | null>(null);
const focus = useFocusRecovery(root);
defineExpose({ restoreFocus: (id: string) => focus.restore(id) });

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
// The notes slide aside for the dragged one and settle into place when it is dropped; Alt+arrows move them at once.
const listEl = ref<HTMLElement | null>(null);
const reorder = useReorderMotion(listEl);

function onDragStart(event: DragEvent, entry: NoteEntry) {
  dragId.value = entry.id;
  reorder.begin(entry.id);
  if (event.currentTarget instanceof HTMLElement) liftedDragImage(event, event.currentTarget);
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", entry.title);
  }
}

function onDragOver(event: DragEvent, entry: NoteEntry) {
  const from = dragId.value ? props.entries.get(dragId.value) : undefined;
  // Over the other group (a note stays in its own): nothing opens a gap.
  if (!from || from.pinned !== entry.pinned) {
    if (from) reorder.preview(null);
    return;
  }
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  // The place comes from the pointer and the layout at the grab, not from the row under it, which slides aside and would be swapped back.
  const among = [...props.entries.values()].filter((other) => other.pinned === from.pinned).map((other) => other.id);
  drop.value = reorder.over(event.clientX, event.clientY, among);
}

function onDrop(event: DragEvent) {
  event.preventDefault();
  const id = dragId.value;
  const place = drop.value;
  clearDrag();
  if (id && place) void reorder.drop(() => emit("reorder", id, place.id, place.after));
  else reorder.cancel();
}

function clearDrag() {
  dragId.value = null;
  drop.value = null;
}

function endDrag() {
  clearDrag();
  reorder.cancel();
}

async function onMove(id: string, delta: -1 | 1) {
  emit("move", id, delta);
  // The row is moved in the list, which drops keyboard focus; give it back.
  await nextTick();
  setTimeout(() => document.querySelector<HTMLElement>(`[data-testid="note-${id}"] button`)?.focus(), 60);
}

function dropShadow(entry: NoteEntry): string | false {
  // The gap that opens is the drop place; the line is for reduced motion.
  if (!reducedMotion()) return false;
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
</script>

<template>
  <nav v-if="collapsed && !narrow" ref="root" class="flex h-full min-w-0 flex-col items-center" :aria-label="t('list.label')" data-testid="notes-rail">
    <Toolbar variant="bar" class="w-full justify-center px-0" :label="t('list.toolbar')">
      <Button variant="ghost" size="icon-sm" data-testid="expand-sidebar" :aria-label="t('list.expand')" :title="t('list.expand')" @click="emit('toggleCollapsed')">
        <PanelLeftOpen />
      </Button>
    </Toolbar>
    <Button variant="ghost" size="icon-sm" class="mt-2 flex-none" data-testid="new-note" :aria-label="t('list.new')" :title="t('list.new')" @click="emit('create')">
      <Plus />
    </Button>
    <ul role="list" class="mt-2 flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-y-auto p-1.5">
      <li v-for="entry in railNotes" :key="entry.id">
        <Button
          variant="ghost"
          size="icon"
          :class="cn('hover:bg-accent relative', entry.id === selectedId && 'bg-accent ring-primary ring-1')"
          :aria-label="railTitle(entry)"
          :aria-current="entry.id === selectedId ? 'true' : undefined"
          :title="railTitle(entry)"
          :data-testid="`rail-${entry.id}`"
          :data-focus-row="entry.id"
          @click="emit('select', entry.id)"
        >
          <NotebookPen v-if="entry.id === SCRATCHPAD_ID" class="text-primary size-4" aria-hidden="true" />
          <span
            v-else
            :class="cn('flex size-6 items-center justify-center rounded-md text-xs font-semibold', entry.pinned ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground')"
            aria-hidden="true"
          >{{ initialOf(entry) ?? "·" }}</span>
          <Pin v-if="entry.pinned" class="text-primary absolute top-0.5 right-0.5 size-2.5 fill-current" aria-hidden="true" />
        </Button>
      </li>
    </ul>
  </nav>
  <nav v-else ref="root" class="flex h-full min-w-0 flex-col" :aria-label="t('list.label')">
    <Toolbar variant="bar" :label="t('list.toolbar')">
      <SearchInput
        v-model="query"
        size="sm"
        class="flex-1"
        data-testid="search"
        data-focus-empty
        :placeholder="t('list.search')"
        :aria-label="t('list.search')"
        :clear-label="t('list.clearSearch')"
      />
      <Button variant="ghost" size="icon-sm" class="flex-none" data-testid="new-note" :aria-label="t('list.new')" :title="t('list.new')" @click="emit('create')">
        <Plus />
      </Button>
      <Button v-if="!narrow" variant="ghost" size="icon-sm" class="flex-none" data-testid="collapse-sidebar" :aria-label="t('list.collapse')" :title="t('list.collapse')" @click="emit('toggleCollapsed')">
        <PanelLeftClose />
      </Button>
    </Toolbar>

    <div ref="listEl" class="min-h-0 flex-1 overflow-y-auto p-1">
      <template v-if="results">
        <EmptyState v-if="!results.length" variant="bare" class="px-3 py-6" :title="t('list.none', { query: query.trim() })" data-testid="no-results" />
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
              :data-reorder-id="entry.id"
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
            :data-reorder-id="entry.id"
            :class="cn(dragId === entry.id && 'opacity-50', dropShadow(entry))"
            @dragstart="onDragStart($event, entry)"
            @dragover="onDragOver($event, entry)"
            @drop="onDrop"
            @dragend="endDrag"
          >
            <NoteRow :entry="entry" :selected="entry.id === selectedId" @select="emit('select', entry.id)" @toggle-pin="emit('togglePin', entry.id)" @remove="emit('remove', entry)" @rename="(title) => emit('rename', entry.id, title)" @move="(delta) => onMove(entry.id, delta)" @renaming="(on) => (renamingId = on ? entry.id : null)" />
          </li>
        </ul>
        <EmptyState v-if="!grouped.pinned.length && !grouped.others.length" variant="bare" class="px-3 py-6" :title="t('list.empty')">
          <template #action><Button variant="secondary" size="sm" @click="emit('create')"><Plus /> {{ t("list.new") }}</Button></template>
        </EmptyState>
      </template>
    </div>
  </nav>

</template>
