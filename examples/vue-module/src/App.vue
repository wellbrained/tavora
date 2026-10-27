<script setup lang="ts">
// Same features and data-testid values as the vanilla and React examples,
// so one set of end-to-end tests covers all three.
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef } from "vue";
import { connect, TavoraError, type TavoraSDK, type TavoraTheme, type TavoraViewport, type TavoraWorkspace } from "@tavora/sdk";

interface Note {
  text: string;
}
type View = "list" | "grid";

const error = ref<string | null>(null);
const tavora = shallowRef<TavoraSDK | null>(null);
const workspace = ref<TavoraWorkspace | null>(null);
const viewport = ref<TavoraViewport | null>(null);
const theme = ref<TavoraTheme | null>(null);
const lifecycle = ref("active");
const count = ref(0);
const note = ref<HTMLTextAreaElement | null>(null);
const noteRevision = ref(0);
const noteStatus = ref("");
const view = ref<View>("list");

const unsubscribe: (() => void)[] = [];
onUnmounted(() => unsubscribe.forEach((fn) => fn()));

async function loadNote(sdk: TavoraSDK) {
  const doc = await sdk.documents.get<Note>("note");
  noteRevision.value = doc?.revision ?? 0;
  // The textarea is rendered once connected; it is uncontrolled on purpose so
  // a reload from another panel replaces the text in one place.
  return doc?.data.text ?? "";
}

onMounted(async () => {
  try {
    const sdk = await connect();
    const [currentWorkspace, initialViewport, initialTheme, savedCount, noteText, panel] = await Promise.all([
      sdk.workspace.getCurrent(),
      sdk.workspace.getViewport(),
      sdk.ui.getTheme(),
      sdk.storage.get<number>("count"),
      loadNote(sdk),
      sdk.panel.getState<{ view: View }>(),
    ]);
    workspace.value = currentWorkspace;
    viewport.value = initialViewport;
    theme.value = initialTheme;
    count.value = savedCount ?? 0;
    view.value = panel?.view ?? "list";
    unsubscribe.push(
      sdk.workspace.onResize((next) => (viewport.value = next)),
      sdk.ui.onThemeChange((next) => (theme.value = next)),
      sdk.lifecycle.onSuspend(() => (lifecycle.value = "suspended")),
      sdk.lifecycle.onResume(() => (lifecycle.value = "active")),
      sdk.documents.onChange(async (change) => {
        if (change.id !== "note") return;
        setNoteText(await loadNote(sdk));
        noteStatus.value = "Updated in another panel";
      }),
    );
    tavora.value = sdk;
    // Wait for the connected template to render before filling the textarea.
    await nextTick();
    setNoteText(noteText);
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
  }
});

function setNoteText(text: string) {
  if (note.value) note.value.value = text;
}

async function increment() {
  count.value += 1;
  await tavora.value!.storage.set("count", count.value);
}

async function saveNote() {
  const sdk = tavora.value!;
  try {
    const saved = await sdk.documents.put({
      id: "note",
      title: "Note",
      data: { text: note.value?.value ?? "" },
      ifRevision: noteRevision.value,
    });
    noteRevision.value = saved.revision;
    noteStatus.value = "Saved";
  } catch (reason) {
    if (!(reason instanceof TavoraError) || reason.code !== "CONFLICT") throw reason;
    // Someone else saved first: show their version instead of overwriting it.
    setNoteText(await loadNote(sdk));
    noteStatus.value = "Changed elsewhere; reloaded";
  }
}

async function choose(next: View) {
  view.value = next;
  await tavora.value!.panel.setState({ view: next });
}

const colors = computed(() => theme.value?.colors);
// Tavora styles buttons and fields already; the one main action gets the accent.
const primary = computed(() => ({ background: colors.value?.accent, color: colors.value?.background }));
</script>

<template>
  <main :style="{ background: colors?.background ?? '#171412', color: colors?.text ?? '#f2ece0' }">
    <h1>Vue Test Module</h1>
    <p v-if="!tavora" data-testid="status">{{ error ? `Could not connect: ${error}` : "Connecting…" }}</p>
    <template v-else>
      <p data-testid="status">Connected</p>
      <dl>
        <dt :style="{ color: colors?.textMuted }">Workspace</dt>
        <dd data-testid="workspace" :data-workspace-id="workspace?.id">{{ workspace?.displayName }}</dd>
        <dt :style="{ color: colors?.textMuted }">Viewport</dt>
        <dd data-testid="viewport">{{ viewport ? `${viewport.width} × ${viewport.height}` : "–" }}</dd>
        <dt :style="{ color: colors?.textMuted }">Theme</dt>
        <dd data-testid="theme">{{ theme?.mode }}</dd>
        <dt :style="{ color: colors?.textMuted }">Panel</dt>
        <dd data-testid="lifecycle">{{ lifecycle }}</dd>
      </dl>

      <section>
        <h2>Clicks saved in this workspace</h2>
        <p data-testid="count">{{ count }}</p>
        <button type="button" data-testid="increment" :style="primary" @click="increment">Add a click</button>
      </section>

      <section>
        <h2>
          Shared note <small>revision <span data-testid="note-revision">{{ noteRevision }}</span></small>
        </h2>
        <textarea ref="note" data-testid="note" rows="3"></textarea>
        <p>
          <button type="button" data-testid="save-note" @click="saveNote">Save note</button>
          <span data-testid="note-status">{{ noteStatus }}</span>
        </p>
      </section>

      <section>
        <h2>This panel's view: <span data-testid="view">{{ view }}</span></h2>
        <button type="button" data-testid="view-list" @click="choose('list')">List</button>
        <button type="button" data-testid="view-grid" @click="choose('grid')">Grid</button>
      </section>
    </template>
  </main>
</template>

<style>
/* Tavora gives the page its font, colours and control styles; this only
   adds layout. */
main {
  padding: 16px;
  min-height: 100vh;
  box-sizing: border-box;
}
dd {
  margin: 0 0 8px;
}
p {
  margin: 4px 0;
}
textarea {
  width: 100%;
}
section button {
  margin-right: 4px;
}
</style>
