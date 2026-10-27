<script setup lang="ts">
// One note in the list. Its menu opens from the ⋯ button or a right-click.
// Double-click on the row (or F2) renames it in place.
import { Ellipsis, NotebookPen, Pencil, Pin, PinOff, Trash2 } from "@lucide/vue";
import { cn } from "@tavora/official-ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@tavora/official-ui/components/ui/dropdown-menu";
import { computed, nextTick, ref, watch } from "vue";
import { locale, plural, t } from "./i18n";
import { MAX_FIXED_TITLE, previewFor, relativeTime, SCRATCHPAD_ID, UNTITLED, type NoteEntry } from "./notes";

const props = defineProps<{ entry: NoteEntry; selected: boolean }>();
const emit = defineEmits<{ select: []; togglePin: []; remove: []; rename: [title: string]; move: [delta: -1 | 1]; renaming: [on: boolean] }>();

const menuOpen = ref(false);
const scratchpad = computed(() => props.entry.id === SCRATCHPAD_ID);
const preview = computed(() => previewFor(props.entry));
const when = computed(() =>
  relativeTime(props.entry.updatedAt, Date.now(), {
    justNow: t("time.justNow"),
    minutes: (count) => plural("time.minutes", count),
    yesterday: t("time.yesterday"),
    locale: locale(),
  }),
);
/** The stored title of the scratchpad and of a note without text are English; show them in the user's language. */
const title = computed(() => (scratchpad.value ? t("scratchpad") : props.entry.title === UNTITLED ? t("untitled") : props.entry.title));

const renaming = ref(false);
const draft = ref("");
/** What the input started with, so an untouched Enter does not turn the first line into a fixed title. */
let initial = "";
const input = ref<HTMLInputElement | null>(null);

// The list stops dragging this row while its title is edited, so text can be selected.
watch(renaming, (on) => emit("renaming", on));

async function startRename() {
  if (scratchpad.value) return;
  initial = props.entry.fixedTitle || (props.entry.title === UNTITLED ? "" : props.entry.title);
  draft.value = initial;
  renaming.value = true;
  await nextTick();
  input.value?.focus();
  input.value?.select();
}

function finishRename(save: boolean) {
  if (!renaming.value) return;
  renaming.value = false;
  if (save && draft.value !== initial) emit("rename", draft.value);
}

/** The menu gives focus back to its button when it closes; wait so that does not end the rename at once. */
function startRenameLater() {
  setTimeout(() => void startRename(), 120);
}

defineExpose({ startRename });
</script>

<template>
  <div
    :class="
      cn(
        'group hover:bg-accent relative flex items-start rounded-md',
        selected && 'bg-accent before:bg-primary before:absolute before:top-2 before:bottom-2 before:left-0 before:w-0.5 before:rounded-full',
      )
    "
    :data-testid="`note-${entry.id}`"
    :data-selected="selected"
    @contextmenu.prevent="menuOpen = true"
  >
    <div v-if="renaming" class="flex min-w-0 flex-1 flex-col items-start gap-0.5 px-3 py-2">
      <input
        ref="input"
        v-model="draft"
        type="text"
        :maxlength="MAX_FIXED_TITLE"
        :placeholder="title"
        :aria-label="t('row.renameLabel')"
        data-testid="rename-input"
        class="bg-background border-ring placeholder:text-muted-foreground h-6 w-full min-w-0 rounded-sm border px-1 text-sm font-medium outline-none"
        @keydown.enter.prevent="finishRename(true)"
        @keydown.esc.stop.prevent="finishRename(false)"
        @dragstart.stop.prevent
        @blur="finishRename(true)"
      />
    </div>
    <button
      v-else
      type="button"
      class="flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left"
      :aria-current="selected ? 'true' : undefined"
      @click="emit('select')"
      @dblclick="startRename"
      @keydown.f2.prevent="startRename"
      @keydown.alt.up.prevent="emit('move', -1)"
      @keydown.alt.down.prevent="emit('move', 1)"
    >
      <span class="flex w-full min-w-0 items-center gap-1.5 text-sm font-medium">
        <NotebookPen v-if="scratchpad" class="text-muted-foreground size-3.5 flex-none" :stroke-width="1.5" aria-hidden="true" />
        <Pin v-else-if="entry.pinned" class="text-muted-foreground size-3.5 flex-none" :stroke-width="1.5" :aria-label="t('row.pinned')" />
        <span class="truncate" data-testid="note-title">{{ title }}</span>
      </span>
      <span class="text-muted-foreground flex w-full min-w-0 gap-2 text-xs">
        <span v-if="when" class="flex-none tabular-nums">{{ when }}</span>
        <span class="truncate">{{ preview || (scratchpad ? t("row.previewScratchpad") : t("row.previewNone")) }}</span>
      </span>
    </button>
    <DropdownMenu v-model:open="menuOpen">
      <DropdownMenuTrigger
        :class="
          cn(
            'text-muted-foreground hover:text-foreground mt-1.5 mr-1 flex size-7 flex-none items-center justify-center rounded-md opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
            (selected || menuOpen) && 'opacity-100',
          )
        "
        :aria-label="t('row.moreFor', { title })"
        :title="t('row.more')"
        data-testid="note-menu"
      >
        <Ellipsis class="size-4" :stroke-width="1.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem v-if="!scratchpad" data-testid="menu-rename" @select="startRenameLater">
          <Pencil :stroke-width="1.5" />
          {{ t("row.rename") }}
        </DropdownMenuItem>
        <DropdownMenuItem v-if="!scratchpad" data-testid="menu-pin" @select="emit('togglePin')">
          <PinOff v-if="entry.pinned" :stroke-width="1.5" />
          <Pin v-else :stroke-width="1.5" />
          {{ entry.pinned ? t("row.unpin") : t("row.pin") }}
        </DropdownMenuItem>
        <DropdownMenuSeparator v-if="!scratchpad" />
        <DropdownMenuItem variant="destructive" data-testid="menu-delete" @select="emit('remove')">
          <Trash2 :stroke-width="1.5" />
          {{ scratchpad ? t("row.clearScratchpad") : t("row.delete") }}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>
