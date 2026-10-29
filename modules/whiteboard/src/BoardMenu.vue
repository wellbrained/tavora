<script setup lang="ts">
// The board dropdown in the header: switch boards, make a new one, rename, clear or delete the current one.
import { ChevronDown, Eraser, Pencil, Plus, Trash2 } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@tavora/official-ui/components/ui/dropdown-menu";
import { Input } from "@tavora/official-ui/components/ui/input";
import { DropdownMenuCheckboxItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from "@tavora/official-ui/components/ui/dropdown-menu";
import { nextTick, ref } from "vue";
import { MAX_NAME, type BoardSummary } from "./boards";
import { t } from "./i18n";
import type { StarterKind } from "./starters";

const props = defineProps<{ boards: BoardSummary[]; currentId: string; currentName: string; canClear: boolean; grid: boolean; ready: boolean; creating: boolean }>();
const emit = defineEmits<{ select: [id: string]; create: [kind: StarterKind]; rename: [name: string]; clear: []; delete: []; grid: [enabled: boolean] }>();

const renaming = ref(false);
const draft = ref("");
const input = ref<{ $el: HTMLInputElement } | null>(null);

function pick(id: unknown) {
  if (typeof id === "string" && id !== props.currentId) emit("select", id);
}

async function startRename() {
  draft.value = props.currentName;
  renaming.value = true;
  await nextTick();
  input.value?.$el.focus();
  input.value?.$el.select();
}

/** The menu gives focus back to its button when it closes; during a rename the input keeps it. */
function keepFocus(event: Event) {
  if (renaming.value) event.preventDefault();
}

function finishRename(save: boolean, event?: Event) {
  if (!renaming.value) return;
  renaming.value = false;
  // What is in the input now, which the draft may not have caught up with yet.
  if (save) emit("rename", event ? (event.target as HTMLInputElement).value : draft.value);
}
</script>

<template>
  <Input
    v-if="renaming"
    ref="input"
    v-model="draft"
    type="text"
    class="h-7 w-56 max-w-full text-sm"
    :maxlength="MAX_NAME"
    :aria-label="t('board.renameLabel')"
    data-testid="board-rename-input"
    @keydown.enter.prevent="finishRename(true, $event)"
    @keydown.esc.stop.prevent="finishRename(false)"
    @blur="finishRename(true, $event)"
  />
  <!-- Kept (hidden) while renaming, so the menu can finish closing. -->
  <div v-show="!renaming" class="contents">
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button type="button" variant="outline" size="sm" class="max-w-56 min-w-0 font-medium" :title="t('board.switch')" data-testid="board-menu">
          <span class="truncate" data-testid="board-name">{{ currentName }}</span>
          <ChevronDown :stroke-width="1.5" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" class="min-w-56" @close-auto-focus="keepFocus" :aria-label="t('board.switch')" data-testid="board-list">
        <DropdownMenuRadioGroup :model-value="currentId" @update:model-value="pick">
          <DropdownMenuRadioItem v-for="board in boards" :key="board.id" :value="board.id" :data-testid="`board-${board.id}`">
            <span class="truncate">{{ board.name }}</span>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger :disabled="creating" data-testid="board-new"><Plus :stroke-width="1.5" />{{ t("board.new") }}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem data-testid="board-new-blank" @select="emit('create', 'blank')">{{ t("starter.blank") }}</DropdownMenuItem>
            <DropdownMenuItem data-testid="board-new-idea" @select="emit('create', 'idea')">{{ t("starter.idea") }}</DropdownMenuItem>
            <DropdownMenuItem data-testid="board-new-screenshot" @select="emit('create', 'screenshot')">{{ t("starter.screenshot") }}</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuCheckboxItem :model-value="grid" :disabled="!ready" data-testid="board-grid" @update:model-value="emit('grid', $event === true)">{{ t("board.grid") }}</DropdownMenuCheckboxItem>
        <DropdownMenuItem data-testid="board-rename" @select="startRename">
          <Pencil :stroke-width="1.5" />
          {{ t("board.rename") }}
        </DropdownMenuItem>
        <!-- Clearing shows Undo afterwards (and Ctrl+Z works), so it needs no question first. -->
        <DropdownMenuItem :disabled="!canClear" :title="t('clear.hint')" data-testid="clear-board" @select="emit('clear')">
          <Eraser :stroke-width="1.5" />
          {{ t("clear.button") }}
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" data-testid="board-delete" @select="emit('delete')">
          <Trash2 :stroke-width="1.5" />
          {{ t("board.delete") }}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>
