<script setup lang="ts">
// The files kept for this game: open one, rename it or remove it. It sits in a popover next to the button that opened it.
// Each row is the kit's list row (as in ActionList) with a visible ⋯ menu beside it; ActionList has no place for that.
import { Ellipsis, FileText, Image as ImageIcon, Pencil, Trash2 } from "@lucide/vue";
import { ActionRow } from "@tavora/official-ui/components/ui/action-row";
import { Button } from "@tavora/official-ui/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@tavora/official-ui/components/ui/dropdown-menu";
import { EmptyState } from "@tavora/official-ui/components/ui/empty-state";
import type { FileEntry } from "./files";
import { locale, t } from "./i18n";

defineProps<{ files: FileEntry[]; activeId: string | null; usage: string }>();
const emit = defineEmits<{ open: [id: string]; rename: [id: string]; remove: [id: string] }>();

function meta(file: FileEntry): string {
  const kind = file.kind === "pdf" ? t("list.kindPdf") : t("list.kindImage");
  if (!file.addedAt) return kind;
  return t("list.meta", { kind, date: new Date(file.addedAt).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" }) });
}
</script>

<template>
  <div class="flex flex-col gap-2" data-testid="file-list">
    <h2 class="px-1 text-sm font-medium">{{ t("list.title") }}</h2>
    <EmptyState v-if="!files.length" :title="t('list.emptyTitle')" :description="t('list.empty')" data-testid="file-list-empty" />
    <ul v-else class="flex max-h-72 flex-col gap-1 overflow-y-auto px-1">
      <li v-for="file in files" :key="file.id" class="flex items-center gap-1" :data-testid="`file-${file.id}`">
        <Button
          variant="ghost"
          class="h-auto min-w-0 flex-1 justify-start gap-3 p-2 font-normal"
          :class="file.id === activeId && 'bg-accent'"
          :aria-current="file.id === activeId ? 'true' : undefined"
          :title="t('list.open', { name: file.name })"
          data-testid="file-open"
          @click="emit('open', file.id)"
        >
          <ActionRow :description="meta(file)">
            <template #icon>
              <FileText v-if="file.kind === 'pdf'" :stroke-width="1.5" />
              <ImageIcon v-else :stroke-width="1.5" />
            </template>
            <span class="[overflow-wrap:anywhere]" data-testid="file-name">{{ file.name }}</span>
          </ActionRow>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="icon-xs" class="flex-none" :title="t('list.more', { name: file.name })" :aria-label="t('list.more', { name: file.name })" data-testid="file-menu">
              <Ellipsis :stroke-width="1.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem data-testid="file-rename" @select="emit('rename', file.id)">
              <Pencil :stroke-width="1.5" />
              {{ t("menu.rename") }}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" data-testid="file-remove" @select="emit('remove', file.id)">
              <Trash2 :stroke-width="1.5" />
              {{ t("menu.remove") }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </li>
    </ul>
    <p v-if="usage" class="text-muted-foreground px-1 text-xs" data-testid="file-usage">{{ usage }}</p>
  </div>
</template>
