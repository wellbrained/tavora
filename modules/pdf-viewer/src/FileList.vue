<script setup lang="ts">
// The files kept for this game: open one, rename it or remove it. It sits in a popover next to the button that opened it.
import { FileText, Image as ImageIcon, Pencil, Trash2 } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import type { FileEntry } from "./files";
import { locale, t } from "./i18n";

defineProps<{ files: FileEntry[]; activeId: string | null; usage: string }>();
const emit = defineEmits<{ open: [id: string]; rename: [id: string]; remove: [id: string] }>();

function meta(file: FileEntry): string {
  const date = file.addedAt ? new Date(file.addedAt).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" }) : "";
  return t("list.meta", { kind: file.kind === "pdf" ? t("list.kindPdf") : t("list.kindImage"), date }).replace(/ · $/, "");
}
</script>

<template>
  <div class="flex flex-col gap-2" data-testid="file-list">
    <h2 class="px-1 text-sm font-medium">{{ t("list.title") }}</h2>
    <p v-if="!files.length" class="text-muted-foreground px-1 py-3 text-sm" data-testid="file-list-empty">{{ t("list.empty") }}</p>
    <ul v-else class="flex max-h-72 flex-col overflow-y-auto">
      <li v-for="file in files" :key="file.id" class="group hover:bg-accent flex items-center rounded-md" :class="file.id === activeId && 'bg-accent'" :data-testid="`file-${file.id}`">
        <button type="button" class="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left" :title="t('list.open', { name: file.name })" data-testid="file-open" @click="emit('open', file.id)">
          <FileText v-if="file.kind === 'pdf'" class="text-muted-foreground size-4 flex-none" :stroke-width="1.5" aria-hidden="true" />
          <ImageIcon v-else class="text-muted-foreground size-4 flex-none" :stroke-width="1.5" aria-hidden="true" />
          <span class="flex min-w-0 flex-col">
            <span class="truncate text-sm font-medium" data-testid="file-name">{{ file.name }}</span>
            <span class="text-muted-foreground truncate text-xs">{{ meta(file) }}</span>
          </span>
        </button>
        <Button variant="ghost" size="icon-xs" class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" :title="t('list.rename', { name: file.name })" :aria-label="t('list.rename', { name: file.name })" data-testid="file-rename" @click="emit('rename', file.id)">
          <Pencil :stroke-width="1.5" />
        </Button>
        <Button variant="ghost" size="icon-xs" class="mr-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100" :title="t('list.remove', { name: file.name })" :aria-label="t('list.remove', { name: file.name })" data-testid="file-remove" @click="emit('remove', file.id)">
          <Trash2 :stroke-width="1.5" />
        </Button>
      </li>
    </ul>
    <p v-if="usage" class="text-muted-foreground px-1 text-xs" data-testid="file-usage">{{ usage }}</p>
  </div>
</template>
