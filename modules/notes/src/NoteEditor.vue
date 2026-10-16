<script setup lang="ts">
// The rich text editor for one note. Saves a moment after typing stops, when
// another note is opened, and when the panel is hidden or closed.
import {
  Bold,
  Check,
  ChevronLeft,
  Ellipsis,
  Eraser,
  FilePlus,
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
  Type,
} from "@lucide/vue";
import { cn, errorMessage } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@tavora/official-ui/components/ui/dropdown-menu";
import type { JSONContent } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";
import { EditorContent, useEditor } from "@tiptap/vue-3";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import LinkDialog from "./LinkDialog.vue";
import LinkPopover from "./LinkPopover.vue";
import { t } from "./i18n";
import {
  contentFromText,
  FONTS,
  fontStack,
  MAX_FIXED_TITLE,
  SCRATCHPAD_ID,
  SIZES,
  sizePx,
  titleFor,
  UNTITLED,
  type NoteData,
  type NoteEntry,
  type RichText,
  type TextStyle,
} from "./notes";
import type { NotePatch, NotesStore } from "./store";

const props = defineProps<{ store: NotesStore; noteId: string; entry: NoteEntry | undefined; narrow: boolean; look: TextStyle }>();
const emit = defineEmits<{ back: []; togglePin: []; clear: []; saveAsNote: []; setStyle: [patch: Partial<TextStyle>]; openLink: [href: string] }>();

/** How long typing must pause before the note is saved. */
const SAVE_DELAY_MS = 400;

type SaveState = "idle" | "pending" | "saving" | "saved" | "error";
const saveState = ref<SaveState>("idle");
const saveError = ref("");
/** The note shown and editable right now, for the page and its tests. */
const loadedNote = ref<string | null>(null);
/** Which note the editor currently holds; null while one is loading. */
let loadedId: string | null = null;
/** The title field's text; empty means the first line is the title. */
const titleDraft = ref("");
const titleInput = ref<HTMLInputElement | null>(null);
let titleFocused = false;
/** Which parts of the note have changes that are not saved yet. */
let contentDirty = false;
let titleDirty = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let saving: Promise<void> = Promise.resolve();
let loading: Promise<void> = Promise.resolve();

const editor = useEditor({
  extensions: [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      // Links are kept and shown; clicking one shows a bar, and Ctrl+click opens it in the Browser.
      link: { openOnClick: false, autolink: true, defaultProtocol: "https", protocols: ["mailto"] },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({
      placeholder: () =>
        props.noteId === SCRATCHPAD_ID
          ? t("editor.placeholderScratchpad")
          : props.entry?.fixedTitle
            ? t("editor.placeholderTitled")
            : t("editor.placeholderNote"),
    }),
  ],
  editorProps: {
    handleClick: (_view, _pos, event) => onEditorClick(event),
    attributes: { class: "note-content", "data-testid": "editor", "aria-label": t("editor.text"), spellcheck: "true" },
  },
  onUpdate: () => {
    linkPopover.value = null;
    if (loadedId === null) return;
    contentDirty = true;
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
  const patch: NotePatch = {};
  if (contentDirty) {
    patch.content = instance.getJSON() as RichText;
    patch.text = instance.getText({ blockSeparator: "\n" });
  }
  if (titleDirty) patch.title = titleDraft.value;
  contentDirty = false;
  titleDirty = false;
  saveState.value = "saving";
  saving = saving
    .then(() => props.store.save(id, patch))
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

/** Shows a note's formatting; a stored note the editor cannot read shows its plain text instead of breaking the panel. */
function showContent(instance: NonNullable<typeof editor.value>, note: NoteData) {
  try {
    instance.commands.setContent(note.content as JSONContent, { emitUpdate: false, errorOnInvalidContent: true });
  } catch {
    instance.commands.setContent(contentFromText(note.text) as JSONContent, { emitUpdate: false });
  }
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
    showContent(editor.value, note.data);
    titleDraft.value = note.data.title;
    contentDirty = false;
    titleDirty = false;
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
  if (!titleFocused) titleDraft.value = note.data.title;
  showContent(instance, note.data);
  const end = instance.state.doc.content.size;
  instance.commands.setTextSelection({ from: Math.min(from, end), to: Math.min(to, end) });
}

/** Drops unsaved typing, e.g. when another panel deleted the note. */
function discard() {
  clearTimeout(timer);
  timer = undefined;
  contentDirty = false;
  titleDirty = false;
  loadedId = null;
  loadedNote.value = null;
  saveState.value = "idle";
}

function onTitleInput() {
  if (loadedId === null) return;
  titleDirty = true;
  saveState.value = "pending";
  clearTimeout(timer);
  timer = setTimeout(() => void flush(), SAVE_DELAY_MS);
}

function onTitleFocus() {
  titleFocused = true;
}

function onTitleBlur() {
  titleFocused = false;
  void flush();
}

/** Another panel or the list renamed the note: show its title, unless this field is being typed in. */
watch(
  () => props.entry?.fixedTitle,
  (title) => {
    if (title === undefined || titleFocused || titleDirty || saveState.value === "pending" || saveState.value === "saving") return;
    if (loadedId === props.noteId) titleDraft.value = title;
  },
);

/** The first-line title, shown greyed out in the empty title field. */
const derivedTitle = computed(() => {
  const title = titleFor(props.noteId, props.entry?.text ?? "");
  return title === UNTITLED ? t("untitled") : title;
});

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

// ── Links ────────────────────────────────────────────────────────────

/** The bar shown under a clicked link. */
const linkPopover = ref<{ href: string; left: number; top: number } | null>(null);

/** Ctrl+click opens a link at once; a plain click puts the cursor in it and shows the bar. */
function onEditorClick(event: MouseEvent): boolean {
  const link = (event.target as HTMLElement | null)?.closest("a");
  const href = link?.getAttribute("href");
  if (!link || !href) {
    linkPopover.value = null;
    return false;
  }
  if (event.ctrlKey || event.metaKey) {
    linkPopover.value = null;
    emit("openLink", href);
    return true;
  }
  const rect = link.getBoundingClientRect();
  linkPopover.value = { href, left: rect.left, top: rect.bottom + 4 };
  return false;
}

function closeLinkPopover(event: Event) {
  if (!linkPopover.value) return;
  if (event.target instanceof Element && event.target.closest("[data-link-popover]")) return;
  linkPopover.value = null;
}

function onLinkKey(event: KeyboardEvent) {
  if (event.key === "Escape" && linkPopover.value) {
    event.stopPropagation();
    linkPopover.value = null;
  }
}

onMounted(() => {
  addEventListener("pointerdown", closeLinkPopover, true);
  addEventListener("keydown", onLinkKey, true);
});
onBeforeUnmount(() => {
  removeEventListener("pointerdown", closeLinkPopover, true);
  removeEventListener("keydown", onLinkKey, true);
});

function popoverOpen() {
  if (linkPopover.value) emit("openLink", linkPopover.value.href);
  linkPopover.value = null;
}

function popoverEdit() {
  linkPopover.value = null;
  openLinkDialog();
}

function popoverRemove() {
  linkPopover.value = null;
  applyLink(null);
}

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

const textStyles = computed(() => [
  { label: t("style.text"), level: 0 },
  { label: t("style.h1"), level: 1 },
  { label: t("style.h2"), level: 2 },
  { label: t("style.h3"), level: 3 },
] as const);

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
      toggle(t("tool.bold"), Bold, "bold", 0, () => e.chain().focus().toggleBold().run()),
      toggle(t("tool.italic"), Italic, "italic", 0, () => e.chain().focus().toggleItalic().run()),
      toggle(t("tool.strike"), Strikethrough, "strike", 580, () => e.chain().focus().toggleStrike().run()),
      toggle(t("tool.code"), Code, "code", 580, () => e.chain().focus().toggleCode().run()),
    ],
    [
      toggle(t("tool.bullets"), List, "bulletList", 420, () => e.chain().focus().toggleBulletList().run()),
      toggle(t("tool.numbers"), ListOrdered, "orderedList", 420, () => e.chain().focus().toggleOrderedList().run()),
      toggle(t("tool.checklist"), ListChecks, "taskList", 0, () => e.chain().focus().toggleTaskList().run()),
    ],
    [
      toggle(t("tool.quote"), Quote, "blockquote", 500, () => e.chain().focus().toggleBlockquote().run()),
      toggle(t("tool.codeBlock"), SquareCode, "codeBlock", 500, () => e.chain().focus().toggleCodeBlock().run()),
      toggle(t("tool.link"), Link2, "link", 420, openLinkDialog),
    ],
  ];
});

/** The back button takes room from the tools in a narrow panel. */
const room = computed(() => width.value - (props.narrow ? 40 : 0) - (props.noteId === SCRATCHPAD_ID ? 64 : 0) - 32);

const lookVars = computed(() => ({ "--note-font": fontStack(props.look.font), "--note-size": `${sizePx(props.look.size)}px` }));
const shownGroups = computed(() =>
  toolGroups.value.map((group) => group.filter((tool) => tool.minWidth <= room.value)).filter((group) => group.length),
);
const moreTools = computed(() => toolGroups.value.flat().filter((tool) => tool.minWidth > room.value));

const scratchpadEmpty = computed(() => editor.value?.isEmpty ?? true);

const statusText = (state: SaveState): string => (state === "idle" ? "" : t(`save.${state}`));
</script>

<template>
  <section ref="root" class="flex h-full min-w-0 flex-col" :aria-label="t('editor.note')" data-testid="note-editor" :data-loaded="loadedNote ?? ''">
    <header class="border-primary/25 bg-primary/5 flex h-10 flex-none items-center gap-1 border-b px-2">
      <Button
        v-if="narrow"
        variant="ghost"
        size="icon-sm"
        class="flex-none"
        data-testid="back"
        :aria-label="t('editor.allNotes')"
        :title="t('editor.allNotes')"
        @click="emit('back')"
      >
        <ChevronLeft :stroke-width="1.5" />
      </Button>
      <div class="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden" role="toolbar" :aria-label="t('editor.formatting')">
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="icon-sm" :aria-label="t('editor.textStyle')" :title="t('editor.textStyle')">
              <Heading :stroke-width="1.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem v-for="style in textStyles" :key="style.level" @select="setTextStyle(style.level)">
              {{ style.label }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="icon-sm" class="flex-none" data-testid="appearance" :aria-label="t('editor.appearance')" :title="t('editor.appearance')">
              <Type :stroke-width="1.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>{{ t("editor.font") }}</DropdownMenuLabel>
            <DropdownMenuItem v-for="font in FONTS" :key="font.id" :data-testid="`font-${font.id}`" @select.prevent="emit('setStyle', { font: font.id })">
              <span :style="{ fontFamily: font.stack }">{{ font.name }}</span>
              <Check v-if="look.font === font.id" class="ml-auto" :stroke-width="1.5" :aria-label="t('editor.on')" />
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{{ t("editor.size") }}</DropdownMenuLabel>
            <DropdownMenuItem v-for="size in SIZES" :key="size.id" :data-testid="`size-${size.id}`" @select.prevent="emit('setStyle', { size: size.id })">
              {{ t(`size.${size.id}`) }}
              <Check v-if="look.size === size.id" class="ml-auto" :stroke-width="1.5" :aria-label="t('editor.on')" />
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <p class="text-muted-foreground px-2 py-1.5 text-xs">{{ noteId === SCRATCHPAD_ID ? t("editor.appliesScratchpad") : t("editor.appliesNotes") }}</p>
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
            <Button variant="ghost" size="icon-sm" class="flex-none" :aria-label="t('editor.moreFormatting')" :title="t('editor.moreFormatting')">
              <Ellipsis :stroke-width="1.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem v-for="tool in moreTools" :key="tool.label" @select="tool.run()">
              <component :is="tool.icon" :stroke-width="1.5" />
              {{ tool.label }}
              <Check v-if="tool.active" class="ml-auto" :stroke-width="1.5" :aria-label="t('editor.on')" />
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
      >{{ statusText(saveState) }}</span>
      <template v-if="noteId === SCRATCHPAD_ID">
        <Button
          variant="ghost"
          size="icon-sm"
          class="flex-none"
          data-testid="save-as-note"
          :disabled="scratchpadEmpty"
          :aria-label="t('editor.saveAsNote')"
          :title="t('editor.saveAsNote')"
          @click="emit('saveAsNote')"
        >
          <FilePlus :stroke-width="1.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          class="flex-none"
          data-testid="clear-scratchpad"
          :disabled="scratchpadEmpty"
          :aria-label="t('editor.clear')"
          :title="t('editor.clear')"
          @click="emit('clear')"
        >
          <Eraser :stroke-width="1.5" />
        </Button>
      </template>
      <Button
        v-else
        variant="ghost"
        size="icon-sm"
        class="flex-none"
        data-testid="toggle-pin"
        :aria-label="entry?.pinned ? t('editor.unpin') : t('editor.pin')"
        :aria-pressed="entry?.pinned ?? false"
        :title="entry?.pinned ? t('editor.unpin') : t('editor.pin')"
        @click="emit('togglePin')"
      >
        <PinOff v-if="entry?.pinned" :stroke-width="1.5" />
        <Pin v-else :stroke-width="1.5" />
      </Button>
    </header>
    <div class="min-h-0 flex-1 overflow-y-auto" :style="lookVars" @scroll.passive="linkPopover = null">
      <div class="mx-auto max-w-[760px] px-4 py-3">
        <input
          v-if="noteId !== SCRATCHPAD_ID"
          ref="titleInput"
          v-model="titleDraft"
          type="text"
          class="note-title placeholder:text-muted-foreground mb-3 w-full min-w-0 border-b border-transparent bg-transparent pb-1 text-xl font-semibold outline-none"
          data-testid="note-title-input"
          :maxlength="MAX_FIXED_TITLE"
          :placeholder="derivedTitle"
          :aria-label="t('editor.title')"
          :disabled="loadedNote !== noteId"
          @input="onTitleInput"
          @focus="onTitleFocus"
          @blur="onTitleBlur"
          @keydown.enter.prevent="editor?.commands.focus('start')"
        />
        <EditorContent :editor="editor" />
      </div>
    </div>
    <LinkPopover v-if="linkPopover" v-bind="linkPopover" @open="popoverOpen" @edit="popoverEdit" @remove="popoverRemove" />
    <LinkDialog v-if="linkOpen" :initial="currentLink" @apply="applyLink" @cancel="linkOpen = false" />
  </section>
</template>

<style>
.note-content {
  font-family: var(--note-font, inherit);
  font-size: var(--note-size, 14px);
  min-height: 60vh;
  outline: none;
  overflow-wrap: anywhere;
}
.note-content > * + * {
  margin-top: 8px;
}
.note-title:focus {
  border-bottom-color: var(--primary);
}
.note-content h1 {
  color: var(--primary);
  font-size: 1.43em;
  line-height: 1.3;
  font-weight: 600;
  margin-top: 16px;
}
.note-content h2 {
  color: var(--primary);
  font-size: 1.14em;
  line-height: 1.375;
  font-weight: 600;
  margin-top: 16px;
}
.note-content h3 {
  font-size: 1em;
  line-height: 1.43;
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
  font-size: 0.93em;
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
