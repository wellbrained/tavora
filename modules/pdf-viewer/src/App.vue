<script setup lang="ts">
// PDF Viewer: a tab per open file, and a list of every file kept for this game. Files are picked or dropped, copied
// into the module's file store and listed in one document that every panel of the workspace shares. Which files a
// panel has open, and which one it shows, is that panel's own state.
import { FilePlus2, FolderOpen, Upload } from "@lucide/vue";
import { connectModule, ConfirmDialog, errorMessage, NameDialog } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import { EmptyState } from "@tavora/official-ui/components/ui/empty-state";
import { Popover, PopoverContent, PopoverTrigger } from "@tavora/official-ui/components/ui/popover";
import { TabStrip, type StripTab } from "@tavora/official-ui/components/ui/tabs";
import { Toaster, toast } from "@tavora/official-ui/components/ui/toast";
import type { TavoraSDK } from "@tavora/sdk";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import FileList from "./FileList.vue";
import ImagePane from "./ImagePane.vue";
import PdfPane from "./PdfPane.vue";
import { ACCEPT_ATTRIBUTE, formatBytes, sortPicked, type FileEntry } from "./files";
import { setLanguage, t } from "./i18n";
import { de, en } from "./locales";
import { createFilesStore, FileProblem, type FilesStore } from "./store";
import { closeTab, emptyTabs, keepExisting, openTab, parseTabState, reorderTabs, type TabState } from "./tabs";

const TOAST_MS = 8000;

const sdk = shallowRef<TavoraSDK | null>(null);
const store = shallowRef<FilesStore | null>(null);
const error = ref<string | null>(null);
const tabState = ref<TabState>(emptyTabs());
const listOpen = ref(false);
const usage = ref("");
const dragging = ref(false);
const picker = ref<HTMLInputElement | null>(null);
const renaming = ref<FileEntry | null>(null);
const removing = ref<FileEntry | null>(null);
const busy = ref(false);

const cleanup: (() => void)[] = [];

const files = computed(() => store.value?.files.value ?? []);
const byId = computed(() => new Map(files.value.map((file) => [file.id, file])));
const tabs = computed<StripTab[]>(() =>
  tabState.value.tabs.flatMap((id) => {
    const file = byId.value.get(id);
    return file ? [{ id, label: file.name, closable: true, renamable: true }] : [];
  }),
);
const active = computed(() => (tabState.value.active ? (byId.value.get(tabState.value.active) ?? null) : null));

function notice(message: string) {
  toast({ title: message, duration: TOAST_MS, testid: "notice-toast" });
}

onMounted(async () => {
  try {
    const connection = await connectModule({ texts: { en, de } });
    if (connection.status !== "ready" || !connection.sdk) throw connection.error;
    const connected = connection.sdk;
    setLanguage(connection.language);
    cleanup.push(connection.onLanguage(setLanguage), connection.dispose);
    const opened = await createFilesStore(connected);
    const saved = parseTabState(await connected.panel.getState<unknown>());
    tabState.value = keepExisting(saved, (id) => opened.find(id) !== undefined);
    sdk.value = connected;
    store.value = opened;
  } catch (reason) {
    error.value = errorMessage(reason);
  }
});

onBeforeUnmount(() => {
  cleanup.forEach((fn) => fn());
  void store.value?.dispose();
});

// Another panel removed a file: its tab goes too.
watch(files, () => {
  if (!store.value) return;
  const next = keepExisting(tabState.value, (id) => byId.value.has(id));
  if (next !== tabState.value) tabState.value = next;
});

watch(
  tabState,
  (state) => void sdk.value?.panel.setState({ tabs: [...state.tabs], active: state.active }).catch(() => undefined),
  { deep: true },
);

// ── Opening files

function chooseFiles() {
  picker.value?.click();
}

async function addFiles(list: File[]) {
  const opened = store.value;
  if (!opened || !list.length) return;
  const { accepted, refused } = sortPicked(list);
  for (const name of refused) notice(t("add.notSupported", { name }));
  for (const index of accepted) {
    const file = list[index]!;
    try {
      const entry = await opened.add(file);
      tabState.value = openTab(tabState.value, entry.id);
    } catch (reason) {
      notice(problemText(reason, file.name));
    }
  }
}

function problemText(reason: unknown, name: string): string {
  if (reason instanceof FileProblem) {
    if (reason.kind === "type") return t("add.notSupported", { name });
    if (reason.kind === "size") return t("add.tooBig", { name, max: formatBytes(Number(reason.message)) });
    if (reason.kind === "full") return t("add.full", { name });
    return t("add.error", { name, error: reason.message });
  }
  return t("add.error", { name, error: errorMessage(reason) });
}

function onPicked(event: Event) {
  const input = event.target as HTMLInputElement;
  const picked = [...(input.files ?? [])];
  input.value = "";
  void addFiles(picked);
}

const hasFiles = (event: DragEvent) => [...(event.dataTransfer?.types ?? [])].includes("Files");

function onDragOver(event: DragEvent) {
  if (!hasFiles(event)) return;
  event.preventDefault();
  dragging.value = true;
}

function onDragLeave(event: DragEvent) {
  // Moving over a child fires leave on the parent too; only the edge of the panel ends the drop.
  if (event.relatedTarget instanceof Node && (event.currentTarget as HTMLElement).contains(event.relatedTarget)) return;
  dragging.value = false;
}

function onDrop(event: DragEvent) {
  dragging.value = false;
  if (!hasFiles(event)) return;
  event.preventDefault();
  void addFiles([...(event.dataTransfer?.files ?? [])]);
}

// ── Tabs and the list

function show(id: string) {
  tabState.value = openTab(tabState.value, id);
  listOpen.value = false;
}

const setActive = (id: string) => (tabState.value = { ...tabState.value, active: id });
const closeOne = (id: string) => (tabState.value = closeTab(tabState.value, id));
const reorder = (ids: string[]) => (tabState.value = reorderTabs(tabState.value, ids));

watch(listOpen, async (open) => {
  if (!open || !store.value) return;
  try {
    const used = await store.value.usage();
    usage.value = t("list.usage", { used: formatBytes(used.bytes), total: formatBytes(used.maxBytes) });
  } catch {
    usage.value = "";
  }
});

function askRename(id: string) {
  const file = byId.value.get(id);
  if (!file) return;
  listOpen.value = false;
  renaming.value = file;
}

async function rename(id: string, name: string) {
  renaming.value = null;
  await store.value?.rename(id, name).catch((reason) => notice(errorMessage(reason)));
}

function askRemove(id: string) {
  const file = byId.value.get(id);
  if (!file) return;
  listOpen.value = false;
  removing.value = file;
}

async function remove() {
  const file = removing.value;
  if (!file || !store.value) return;
  busy.value = true;
  try {
    await store.value.remove(file.id);
    tabState.value = closeTab(tabState.value, file.id);
    removing.value = null;
  } catch (reason) {
    removing.value = null;
    notice(errorMessage(reason));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <p v-if="!store" class="text-muted-foreground p-4 text-sm" data-testid="status">
    {{ error ? t("connectError") : t("loading") }}
  </p>
  <div v-else class="relative flex h-full min-h-0 flex-col" data-testid="pdf-viewer-app" @dragover="onDragOver" @dragleave="onDragLeave" @drop="onDrop">
    <header class="bg-card flex items-center border-b px-1 py-1">
      <TabStrip class="min-w-0 flex-1" :tabs="tabs" :model-value="tabState.active ?? undefined" :aria-label="t('tabs.label')" @update:model-value="setActive" @close="closeOne" @reorder="reorder" @rename="rename">
        <template #add>
          <Button variant="ghost" size="icon-sm" :title="t('tabs.open')" :aria-label="t('tabs.open')" data-testid="open-file" @click="chooseFiles">
            <FilePlus2 :stroke-width="1.5" />
          </Button>
        </template>
      </TabStrip>
      <Popover v-model:open="listOpen">
        <PopoverTrigger as-child>
          <Button variant="ghost" size="icon-sm" class="flex-none" :title="t('tabs.files')" :aria-label="t('tabs.files')" data-testid="file-list-toggle">
            <FolderOpen :stroke-width="1.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" class="w-80">
          <FileList :files="files" :active-id="tabState.active" :usage="usage" @open="show" @rename="askRename" @remove="askRemove" />
        </PopoverContent>
      </Popover>
    </header>

    <main class="min-h-0 flex-1">
      <PdfPane v-if="active?.kind === 'pdf'" :key="active.id" :url="store.url(active.id)" :view="active.view" @view="store.setView(active.id, $event)" />
      <ImagePane v-else-if="active" :key="active.id" :url="store.url(active.id)" :name="active.name" :view="active.view" @view="store.setView(active.id, $event)" />
      <div v-else class="flex h-full items-center justify-center p-4">
        <EmptyState :title="t('empty.title')" :description="t('empty.description')" class="w-full max-w-sm" data-testid="empty">
          <template #icon><Upload :stroke-width="1.5" /></template>
          <template #action>
            <div class="flex flex-wrap justify-center gap-2">
              <Button data-testid="empty-open" @click="chooseFiles"><FilePlus2 :stroke-width="1.5" />{{ t("empty.open") }}</Button>
              <Button v-if="files.length" variant="secondary" data-testid="empty-list" @click="listOpen = true"><FolderOpen :stroke-width="1.5" />{{ t("empty.list") }}</Button>
            </div>
          </template>
        </EmptyState>
      </div>
    </main>

    <div v-if="dragging" class="bg-background/80 border-primary pointer-events-none absolute inset-1 z-20 flex items-center justify-center rounded-lg border-2 border-dashed" data-testid="drop-hint">
      <p class="text-sm font-medium">{{ t("drop.hint") }}</p>
    </div>

    <input ref="picker" type="file" multiple class="hidden" :accept="ACCEPT_ATTRIBUTE" :aria-label="t('pick.label')" data-testid="file-input" @change="onPicked" />

    <NameDialog v-if="renaming" :title="t('rename.title')" :label="t('rename.label')" :confirm="t('rename.save')" :cancel="t('cancel')" :value="renaming.name" @submit="rename(renaming.id, $event)" @cancel="renaming = null" />
    <ConfirmDialog v-if="removing" :title="t('remove.title', { name: removing.name })" :description="t('remove.description')" :confirm="t('remove.confirm')" :cancel="t('cancel')" :busy="busy" @confirm="remove" @cancel="removing = null" />
    <Toaster />
  </div>
</template>
