<script setup lang="ts">
// One note in the list. Its menu opens from the ⋯ button or a right-click.
import { Ellipsis, NotebookPen, Pin, PinOff, Trash2 } from "@lucide/vue";
import { cn } from "@tavora/official-ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@tavora/official-ui/components/ui/dropdown-menu";
import { computed, ref } from "vue";
import { previewFor, relativeTime, SCRATCHPAD_ID, type NoteEntry } from "./notes";

const props = defineProps<{ entry: NoteEntry; selected: boolean }>();
const emit = defineEmits<{ select: []; togglePin: []; remove: [] }>();

const menuOpen = ref(false);
const scratchpad = computed(() => props.entry.id === SCRATCHPAD_ID);
const preview = computed(() => previewFor(props.entry));
const when = computed(() => relativeTime(props.entry.updatedAt));
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
    <button
      type="button"
      class="flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left"
      :aria-current="selected ? 'true' : undefined"
      @click="emit('select')"
    >
      <span class="flex w-full min-w-0 items-center gap-1.5 text-sm font-medium">
        <NotebookPen v-if="scratchpad" class="text-muted-foreground size-3.5 flex-none" :stroke-width="1.5" aria-hidden="true" />
        <Pin v-else-if="entry.pinned" class="text-muted-foreground size-3.5 flex-none" :stroke-width="1.5" aria-label="Pinned" />
        <span class="truncate" data-testid="note-title">{{ entry.title }}</span>
      </span>
      <span class="text-muted-foreground flex w-full min-w-0 gap-2 text-xs">
        <span v-if="when" class="flex-none tabular-nums">{{ when }}</span>
        <span class="truncate">{{ preview || (scratchpad ? "Always here for quick notes" : "No more text") }}</span>
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
        :aria-label="`More for ${entry.title}`"
        title="More"
        data-testid="note-menu"
      >
        <Ellipsis class="size-4" :stroke-width="1.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem v-if="!scratchpad" data-testid="menu-pin" @select="emit('togglePin')">
          <PinOff v-if="entry.pinned" :stroke-width="1.5" />
          <Pin v-else :stroke-width="1.5" />
          {{ entry.pinned ? "Unpin" : "Pin to top" }}
        </DropdownMenuItem>
        <DropdownMenuSeparator v-if="!scratchpad" />
        <DropdownMenuItem variant="destructive" data-testid="menu-delete" @select="emit('remove')">
          <Trash2 :stroke-width="1.5" />
          {{ scratchpad ? "Clear scratchpad…" : "Delete note…" }}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>
