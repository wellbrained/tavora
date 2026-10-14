<script setup lang="ts">
// The rich text editor for one note. Saves a moment after typing stops, when
// another note is opened, and when the panel is hidden or closed.
import {
  Bold,
  Check,
  ChevronLeft,
  Ellipsis,
  Code,
  Heading,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Pin,
  PinOff,
  Quote,
  SquareCode,
  Strikethrough,
} from "@lucide/vue";
import { cn, errorMessage } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@tavora/official-ui/components/ui/dropdown-menu";
import type { JSONContent } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";
import { EditorContent, useEditor } from "@tiptap/vue-3";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import LinkDialog from "./LinkDialog.vue";
import { SCRATCHPAD_ID, type NoteEntry, type RichText } from "./notes";
import type { NotesStore } from "./store";

const props = defineProps<{ store: NotesStore; noteId: string; entry: NoteEntry | undefined; narrow: boolean }>();
const emit = defineEmits<{ back: []; togglePin: [] }>();

/** How long typing must pause before the note is saved. */
const SAVE_DELAY_MS = 400;

type SaveState = "idle" | "pending" | "saving" | "saved" | "error";
const saveState = ref<SaveState>("idle");
const saveError = ref("");
/** The note shown and editable right now, for the page and its tests. */
const loadedNote = ref<string | null>(null);
/** Which note the editor currently holds; null while one is loading. */
let loadedId: string | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let saving: Promise<void> = Promise.resolve();
let loading: Promise<void> = Promise.resolve();

const editor = useEditor({
  extensions: [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      // Module panels cannot open pages yet; links are kept and shown.
      link: { openOnClick: false, autolink: true, defaultProtocol: "https", protocols: ["mailto"] },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({
      placeholder: () =>
        props.noteId === SCRATCHPAD_ID ? "Quick thoughts, builds, reminders…" : "Start with a title on the first line",
    }),
  ],
  editorProps: {
    attributes: { class: "note-content", "data-testid": "editor", "aria-label": "Note text", spellcheck: "true" },
  },
  onUpdate: () => {
    if (loadedId === null) return;
    saveState.value = "pending";
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), SAVE_DELAY_MS);
  },
});

/** Saves pending changes now. Resolves once they are stored (or failed). */
function flush(): Promise<void> {
  clearTimeout(timer);
  timer = undefined;
  const instance = editor.value;
  const id = loadedId;
  if (!instance || id === null || saveState.value !== "pending") return saving;
  const content = instance.getJSON() as RichText;
  const text = instance.getText({ blockSeparator: "\n" });
  saveState.value = "saving";
  saving = saving
    .then(() => props.store.saveContent(id, content, text))
    .then(
      () => {
        if (saveState.value === "saving") saveState.value = "saved";
      },
      (error: unknown) => {
        saveError.value = errorMessage(error);
        saveState.value = "error";
      },
    );
  return saving;
}

async function load(id: string) {
  loadedId = null;
  loadedNote.value = null;
  saveState.value = "idle";
  // Nothing typed while the note loads would be kept, so take no input.
  editor.value?.setEditable(false, false);
  try {
    const note = await props.store.open(id);
    // Another note was picked while this one loaded.
    if (props.noteId !== id || !editor.value) return;
    editor.value.commands.setContent(note.data.content as JSONContent, { emitUpdate: false });
    loadedId = id;
    loadedNote.value = id;
  } finally {
    if (props.noteId === id) editor.value?.setEditable(true, false);
  }
}

watch(
  [() => props.noteId, editor],
  ([id], old) => {
    const previous = old?.[0];
    loading = (async () => {
      if (previous !== undefined && previous !== id) await flush();
      if (editor.value) await load(id);
    })();
  },
  { immediate: true },
);

/**
 * Another panel saved this note. Take its text unless this panel has
 * unsaved typing of its own, which then wins on its next save.
 */
async function reloadFromOtherPanel() {
  const instance = editor.value;
  const busy = () => saveState.value === "pending" || saveState.value === "saving";
  if (!instance || loadedId !== props.noteId || busy()) return;
  const note = await props.store.open(props.noteId);
  if (busy()) return;
  const { from, to } = instance.state.selection;
  instance.commands.setContent(note.data.content as JSONContent, { emitUpdate: false });
  const end = instance.state.doc.content.size;
  instance.commands.setTextSelection({ from: Math.min(from, end), to: Math.min(to, end) });
}

/** Drops unsaved typing, e.g. when another panel deleted the note. */
function discard() {
  clearTimeout(timer);
  timer = undefined;
  loadedId = null;
  loadedNote.value = null;
  saveState.value = "idle";
}

/** Puts the cursor in the note once it has loaded. */
async function focus() {
  await loading;
  editor.value?.commands.focus("end");
}

defineExpose({ flush, reloadFromOtherPanel, discard, focus, reload: () => (loading = load(props.noteId)) });

onBeforeUnmount(() => {
  void flush();
  editor.value?.destroy();
});

// ── Toolbar ──────────────────────────────────────────────────────────

const linkOpen = ref(false);
const currentLink = ref("");

function openLinkDialog() {
  currentLink.value = (editor.value?.getAttributes("link").href as string | undefined) ?? "";
  linkOpen.value = true;
}

function applyLink(href: string | null) {
  linkOpen.value = false;
  const chain = editor.value?.chain().focus().extendMarkRange("link");
  if (!chain) return;
  if (href) chain.setLink({ href }).run();
  else chain.unsetLink().run();
}

const textStyles = [
  { label: "Text", level: 0 },
  { label: "Heading 1", level: 1 },
  { label: "Heading 2", level: 2 },
  { label: "Heading 3", level: 3 },
] as const;

function setTextStyle(level: 0 | 1 | 2 | 3) {
  const chain = editor.value?.chain().focus();
  if (!chain) return;
  if (level === 0) chain.setParagraph().run();
  else chain.setHeading({ level }).run();
}

interface Tool {
  label: string;
  icon: typeof Bold;
  active: boolean;
  run(): void;
  /** Narrowest editor, in CSS pixels, at which the tool sits in the toolbar rather than under More. */
  minWidth: number;
}

// The editor's width decides which tools fit; the rest move under More, so
// the toolbar never scrolls.
const root = ref<HTMLElement | null>(null);
const width = ref(Number.POSITIVE_INFINITY);
const observer = new ResizeObserver(([entry]) => {
  if (entry) width.value = entry.contentRect.width;
});
watch(root, (element, previous) => {
  if (previous) observer.unobserve(previous);
  if (element) observer.observe(element);
});
onBeforeUnmount(() => observer.disconnect());

const toolGroups = computed((): Tool[][] => {
  const e = editor.value;
  if (!e) return [];
  const toggle = (label: string, icon: typeof Bold, name: string, minWidth: number, run: () => void): Tool => ({
    label,
    icon,
    active: e.isActive(name),
    run,
    minWidth,
  });
  return [
    [
      toggle("Bold", Bold, "bold", 0, () => e.chain().focus().toggleBold().run()),
      toggle("Italic", Italic, "italic", 0, () => e.chain().focus().toggleItalic().run()),
      toggle("Strikethrough", Strikethrough, "strike", 580, () => e.chain().focus().toggleStrike().run()),
      toggle("Inline code", Code, "code", 580, () => e.chain().focus().toggleCode().run()),
    ],
    [
      toggle("Bulleted list", List, "bulletList", 420, () => e.chain().focus().toggleBulletList().run()),
      toggle("Numbered list", ListOrdered, "orderedList", 420, () => e.chain().focus().toggleOrderedList().run()),
      toggle("Checklist", ListChecks, "taskList", 0, () => e.chain().focus().toggleTaskList().run()),
    ],
    [
      toggle("Quote", Quote, "blockquote", 500, () => e.chain().focus().toggleBlockquote().run()),
      toggle("Code block", SquareCode, "codeBlock", 500, () => e.chain().focus().toggleCodeBlock().run()),
      toggle("Link", Link2, "link", 420, openLinkDialog),
    ],
  ];
});

/** The back button takes room from the tools in a narrow panel. */
const room = computed(() => width.value - (props.narrow ? 40 : 0));
const shownGroups = computed(() =>
  toolGroups.value.map((group) => group.filter((tool) => tool.minWidth <= room.value)).filter((group) => group.length),
);
const moreTools = computed(() => toolGroups.value.flat().filter((tool) => tool.minWidth > room.value));

const STATUS_TEXT: Record<SaveState, string> = {
  idle: "",
  pending: "Editing",
  saving: "Saving…",
  saved: "Saved",
  error: "Could not save",
};
</script>

<template>
  <section ref="root" class="flex h-full min-w-0 flex-col" aria-label="Note" data-testid="note-editor" :data-loaded="loadedNote ?? ''">
    <header class="flex h-10 flex-none items-center gap-1 border-b px-2">
      <Button
        v-if="narrow"
        variant="ghost"
        size="icon-sm"
        class="flex-none"
        data-testid="back"
        aria-label="All notes"
        title="All notes"
        @click="emit('back')"
      >
        <ChevronLeft :stroke-width="1.5" />
      </Button>
      <div class="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden" role="toolbar" aria-label="Formatting">
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="icon-sm" aria-label="Text style" title="Text style">
              <Heading :stroke-width="1.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem v-for="style in textStyles" :key="style.level" @select="setTextStyle(style.level)">
              {{ style.label }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <template v-for="(group, index) in shownGroups" :key="index">
          <span class="bg-border mx-1 h-4 w-px flex-none" aria-hidden="true" />
          <Button
            v-for="tool in group"
            :key="tool.label"
            variant="ghost"
            size="icon-sm"
            :class="cn('flex-none', tool.active && 'bg-accent text-foreground')"
            :aria-label="tool.label"
            :aria-pressed="tool.active"
            :title="tool.label"
            @mousedown.prevent
            @click="tool.run()"
          >
            <component :is="tool.icon" :stroke-width="1.5" />
          </Button>
        </template>
        <DropdownMenu v-if="moreTools.length">
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="icon-sm" class="flex-none" aria-label="More formatting" title="More formatting">
              <Ellipsis :stroke-width="1.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem v-for="tool in moreTools" :key="tool.label" @select="tool.run()">
              <component :is="tool.icon" :stroke-width="1.5" />
              {{ tool.label }}
              <Check v-if="tool.active" class="ml-auto" :stroke-width="1.5" aria-label="On" />
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <span
        :class="cn('flex-none px-1 text-xs', saveState === 'error' ? 'text-destructive' : 'text-muted-foreground')"
        role="status"
        data-testid="save-state"
        :data-state="saveState"
        :title="saveState === 'error' ? saveError : undefined"
      >{{ STATUS_TEXT[saveState] }}</span>
      <Button
        v-if="noteId !== SCRATCHPAD_ID"
        variant="ghost"
        size="icon-sm"
        class="flex-none"
        data-testid="toggle-pin"
        :aria-label="entry?.pinned ? 'Unpin note' : 'Pin note'"
        :aria-pressed="entry?.pinned ?? false"
        :title="entry?.pinned ? 'Unpin note' : 'Pin note'"
        @click="emit('togglePin')"
      >
        <PinOff v-if="entry?.pinned" :stroke-width="1.5" />
        <Pin v-else :stroke-width="1.5" />
      </Button>
    </header>
    <div class="min-h-0 flex-1 overflow-y-auto">
      <EditorContent :editor="editor" class="mx-auto max-w-[760px] px-4 py-3" />
    </div>
    <LinkDialog v-if="linkOpen" :initial="currentLink" @apply="applyLink" @cancel="linkOpen = false" />
  </section>
</template>

<style>
.note-content {
  min-height: 60vh;
  outline: none;
  overflow-wrap: anywhere;
}
.note-content > * + * {
  margin-top: 8px;
}
.note-content h1 {
  font-size: 20px;
  line-height: 26px;
  font-weight: 600;
  margin-top: 16px;
}
.note-content h2 {
  font-size: 16px;
  line-height: 22px;
  font-weight: 600;
  margin-top: 16px;
}
.note-content h3 {
  font-size: 14px;
  line-height: 20px;
  font-weight: 600;
  margin-top: 12px;
}
.note-content > :first-child {
  margin-top: 0;
}
.note-content ul,
.note-content ol {
  padding-left: 22px;
}
.note-content ul {
  list-style: disc;
}
.note-content ol {
  list-style: decimal;
}
.note-content li > p {
  margin: 0;
}
.note-content ul[data-type="taskList"] {
  list-style: none;
  padding-left: 2px;
}
.note-content ul[data-type="taskList"] li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.note-content ul[data-type="taskList"] li > label {
  flex: none;
  margin-top: 2px;
}
.note-content ul[data-type="taskList"] li > label input {
  width: 16px;
  height: 16px;
}
.note-content ul[data-type="taskList"] li > div {
  flex: 1;
  min-width: 0;
}
.note-content ul[data-type="taskList"] li[data-checked="true"] > div {
  color: var(--muted-foreground);
  text-decoration: line-through;
}
.note-content blockquote {
  border-left: 3px solid var(--border);
  padding-left: 12px;
  color: var(--muted-foreground);
}
.note-content code {
  font-family: var(--font-mono);
  font-size: 13px;
  background: var(--muted);
  border-radius: 4px;
  padding: 1px 4px;
}
.note-content pre {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 8px 12px;
  overflow-x: auto;
}
.note-content pre code {
  background: none;
  padding: 0;
}
.note-content a {
  color: var(--primary);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.note-content hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 16px 0;
}
.note-content p.is-editor-empty:first-child::before {
  content: attr(data-placeholder);
  color: var(--muted-foreground);
  float: left;
  height: 0;
  pointer-events: none;
}
</style>
