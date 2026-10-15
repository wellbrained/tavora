<script setup lang="ts">
// Notes: a list and an editor side by side, or one at a time when the panel
// is narrow. Every Notes panel of a game shows the same notes; which note a
// panel shows is that panel's own state.
import { ConfirmDialog, connectModule, errorMessage } from "@tavora/official-ui";
import type { TavoraSDK } from "@tavora/sdk";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import NoteEditor from "./NoteEditor.vue";
import NoteList from "./NoteList.vue";
import { setLanguage, t } from "./i18n";
import { emptyContent, SCRATCHPAD_ID, UNTITLED, type NoteEntry } from "./notes";
import { createNotesStore, type NotesStore } from "./store";

/** Below this width the list and the editor take turns. */
const NARROW_PX = 560;

const sdk = shallowRef<TavoraSDK | null>(null);
const store = shallowRef<NotesStore | null>(null);
const error = ref<string | null>(null);
const selectedId = ref(SCRATCHPAD_ID);
const query = ref("");
const width = ref(window.innerWidth);
const narrow = computed(() => width.value < NARROW_PX);
/** In a narrow panel: whether the list or the editor is showing. */
const showList = ref(false);
const pendingRemove = ref<NoteEntry | null>(null);
const editor = ref<InstanceType<typeof NoteEditor> | null>(null);
/** A note made with New note that has no text yet; it is dropped if left empty. */
let freshId: string | null = null;

const entries = computed(() => store.value?.entries.value ?? new Map<string, NoteEntry>());
const selected = computed(() => entries.value.get(selectedId.value));

const cleanup: (() => void)[] = [];
const onResize = () => (width.value = window.innerWidth);
const flushNow = () => void editor.value?.flush();

onMounted(async () => {
  addEventListener("resize", onResize);
  addEventListener("pagehide", flushNow);
  cleanup.push(() => removeEventListener("resize", onResize), () => removeEventListener("pagehide", flushNow));
  try {
    const connected = await connectModule(setLanguage);
    const notes = createNotesStore(connected);
    const [state] = await Promise.all([connected.panel.getState<{ selected?: string }>(), notes.load()]);
    const saved = state?.selected;
    if (typeof saved === "string" && notes.entries.value.has(saved)) selectedId.value = saved;
    cleanup.push(
      connected.documents.onChange((change) => void onOtherPanel(change.id, change.deleted)),
      connected.lifecycle.onSuspend(flushNow),
      connected.lifecycle.onDispose(flushNow),
    );
    sdk.value = connected;
    store.value = notes;
  } catch (reason) {
    error.value = errorMessage(reason);
  }
});

onBeforeUnmount(() => cleanup.forEach((fn) => fn()));

async function onOtherPanel(id: string, deleted: boolean) {
  const notes = store.value!;
  if (deleted) {
    notes.forget(id);
    if (id === selectedId.value) {
      editor.value?.discard();
      await select(SCRATCHPAD_ID);
    }
    return;
  }
  await notes.refresh(id);
  if (id === selectedId.value) await editor.value?.reloadFromOtherPanel();
}

async function select(id: string) {
  if (narrow.value) showList.value = false;
  if (id === selectedId.value) return;
  await editor.value?.flush();
  const fresh = freshId;
  if (fresh && fresh !== id) {
    freshId = null;
    const entry = store.value!.entries.value.get(fresh);
    if (entry && !entry.text.trim()) await store.value!.remove(fresh).catch(() => undefined);
  }
  selectedId.value = id;
  void sdk.value!.panel.setState({ selected: id });
}

async function create() {
  query.value = "";
  const id = await store.value!.create();
  await select(id);
  freshId = id;
  await nextTick();
  await editor.value?.focus();
}

async function togglePin(id: string) {
  const entry = entries.value.get(id);
  if (entry) await store.value!.setPinned(id, !entry.pinned);
}

async function confirmRemove() {
  const entry = pendingRemove.value!;
  pendingRemove.value = null;
  const notes = store.value!;
  const open = entry.id === selectedId.value;
  if (open) editor.value?.discard();
  if (entry.id === SCRATCHPAD_ID) {
    await notes.saveContent(SCRATCHPAD_ID, emptyContent(), "");
    if (open) await editor.value?.reload();
    return;
  }
  await notes.remove(entry.id);
  if (freshId === entry.id) freshId = null;
  if (open) await select(SCRATCHPAD_ID);
}
</script>

<template>
  <p v-if="!store" class="text-muted-foreground p-4 text-sm" data-testid="status">
    {{ error ? t("connectError", { error }) : t("loading") }}
  </p>
  <div v-else class="flex h-full min-h-0" data-testid="notes-app" :data-narrow="narrow">
    <aside
      v-show="!narrow || showList"
      :class="narrow ? 'w-full' : 'w-60 flex-none border-r'"
      class="bg-card h-full min-w-0"
    >
      <NoteList
        v-model:query="query"
        :entries="entries"
        :selected-id="selectedId"
        @select="select"
        @create="create"
        @toggle-pin="togglePin"
        @remove="(entry) => (pendingRemove = entry)"
      />
    </aside>
    <main v-show="!narrow || !showList" class="h-full min-w-0 flex-1">
      <NoteEditor
        ref="editor"
        :store="store"
        :note-id="selectedId"
        :entry="selected"
        :narrow="narrow"
        @back="showList = true"
        @toggle-pin="togglePin(selectedId)"
      />
    </main>
    <ConfirmDialog
      v-if="pendingRemove"
      :title="pendingRemove.id === SCRATCHPAD_ID ? t('remove.clearTitle') : t('remove.deleteTitle', { title: pendingRemove.title === UNTITLED ? t('untitled') : pendingRemove.title })"
      :description="
        pendingRemove.id === SCRATCHPAD_ID
          ? t('remove.clearMessage')
          : t('remove.deleteMessage')
      "
      :confirm="pendingRemove.id === SCRATCHPAD_ID ? t('remove.clearConfirm') : t('remove.deleteConfirm')"
      :cancel="t('cancel')"
      @confirm="confirmRemove"
      @cancel="pendingRemove = null"
    />
  </div>
</template>
