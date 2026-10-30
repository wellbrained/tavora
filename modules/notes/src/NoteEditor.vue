<script setup lang="ts">
// The rich text editor for one note. Saves a moment after typing stops, when
// another note is opened, and when the panel is hidden or closed.
import {
  Bold,
  Check,
  PanelLeftOpen,
  Ellipsis,
  Eraser,
  FilePlus,
  Code,
  Heading,
  ImagePlus,
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
import type { DocumentHandle } from "@tavora/sdk/store";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import ImageBar from "./ImageBar.vue";
import ImageLightbox from "./ImageLightbox.vue";
import { ImageNode } from "./ImageNode";
import LinkDialog from "./LinkDialog.vue";
import LinkPopover from "./LinkPopover.vue";
import { t } from "./i18n";
import {
  cleanTitle,
  collectImageIds,
  contentFromText,
  FONTS,
  fontStack,
  formatMegabytes,
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
import { useNoteImages } from "./noteImages";
import type { NotesStore } from "./store";

const props = defineProps<{ store: NotesStore; noteId: string; entry: NoteEntry | undefined; narrow: boolean; look: TextStyle }>();
const emit = defineEmits<{ back: []; togglePin: []; clear: []; saveAsNote: []; setStyle: [patch: Partial<TextStyle>]; openLink: [href: string]; notice: [message: string] }>();

/** How long typing must pause before the note is handed to the document store, which saves it at once. */
const SAVE_DELAY_MS = 400;

type SaveState = "idle" | "pending" | "saving" | "saved" | "error";
const saveState = ref<SaveState>("idle");
const saveError = ref("");
/** The note shown and editable right now, for the page and its tests. */
const loadedNote = ref<string | null>(null);
/** The note's document the editor holds; null while none is bound. */
let handle: DocumentHandle<NoteData> | null = null;
let boundId: string | null = null;
let unbind: (() => void)[] = [];
/** The title field's text; empty means the first line is the title. */
const titleDraft = ref("");
const titleInput = ref<HTMLInputElement | null>(null);
let titleFocused = false;
/** Which parts of the note have changes that were not handed to the document store yet. */
let contentDirty = false;
let titleDirty = false;
let timer: ReturnType<typeof setTimeout> | undefined;

/** The editor has typing of its own that another panel's copy must not replace: waiting for the store, or being saved. */
const busy = () => contentDirty || titleDirty || saveState.value === "pending" || saveState.value === "saving";

const { adding, lightbox, fileInput, imageUsage, imageBar, onFiles, onFilePicked, refreshImageUsage, updateImageBar, setImage, openSelectedImage, removeSelectedImage } = useNoteImages({
  store: () => props.store,
  editor: () => editor.value,
  loadedNote: () => loadedNote.value,
  notice: (message) => emit("notice", message),
});

const editor = useEditor({
  extensions: [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      // Links are kept and shown; clicking one shows a bar, and Ctrl+click opens it in the Browser.
      link: { openOnClick: false, autolink: true, defaultProtocol: "https", protocols: ["mailto"] },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    ImageNode.configure({ url: (id) => props.store.blobUrl(id), onOpen: (id) => (lightbox.value = id) }),
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
    handlePaste: (_view, event) => onFiles(event.clipboardData?.files, event),
    handleDrop: (view, event) => onFiles(event.dataTransfer?.files, event, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos),
    attributes: { class: "note-content", "data-testid": "editor", "aria-label": t("editor.text"), spellcheck: "true" },
  },
  onSelectionUpdate: () => updateImageBar(),
  onUpdate: () => {
    linkPopover.value = null;
    updateImageBar();
    if (!handle || props.store.deleted.value) return;
    contentDirty = true;
    saveState.value = "pending";
    schedule();
  },
});

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => void flush().catch(() => undefined), SAVE_DELAY_MS);
}

/** Hands pending changes to the document store and saves now. Resolves once they are stored (or failed). */
async function flush(): Promise<void> {
  clearTimeout(timer);
  timer = undefined;
  const instance = editor.value;
  const open = handle;
  if (!open || props.store.deleted.value) return;
  if (instance && (contentDirty || titleDirty)) {
    const content = contentDirty ? (instance.getJSON() as RichText) : null;
    const text = contentDirty ? instance.getText({ blockSeparator: "\n" }) : "";
    const title = titleDirty ? titleDraft.value : null;
    contentDirty = false;
    titleDirty = false;
    saveState.value = "saving";
    open.update((draft) => {
      if (content) {
        draft.content = content;
        draft.images = collectImageIds(content);
        draft.text = text;
      }
      if (title !== null) draft.title = cleanTitle(title);
    });
  }
  await open.flush();
}

/** Shows a note's formatting; a stored note the editor cannot read shows its plain text instead of breaking the panel. */
function showContent(instance: NonNullable<typeof editor.value>, note: NoteData) {
  try {
    instance.commands.setContent(note.content as JSONContent, { emitUpdate: false, errorOnInvalidContent: true });
  } catch {
    instance.commands.setContent(contentFromText(note.text) as JSONContent, { emitUpdate: false });
  }
}

/** Holds a note's document: shows it and follows its save state. Runs again when another note is shown. */
function bind(next: DocumentHandle<NoteData> | null) {
  for (const off of unbind.splice(0)) off();
  clearTimeout(timer);
  timer = undefined;
  contentDirty = false;
  titleDirty = false;
  handle = next;
  boundId = next ? props.store.selectedId.value : null;
  loadedNote.value = null;
  saveState.value = "idle";
  const instance = editor.value;
  if (!next || !instance) return;
  showContent(instance, next.data);
  titleDraft.value = next.data.title;
  instance.setEditable(!props.store.deleted.value, false);
  loadedNote.value = boundId;
  unbind.push(
    next.onStatus((status) => {
      if (status === "error") saveState.value = "error";
      else if (status === "idle") saveState.value = saveState.value === "saving" || saveState.value === "error" ? "saved" : saveState.value;
      else if (saveState.value !== "pending") saveState.value = "saving";
    }),
    next.onError((error, kind) => {
      if (kind === "save") saveError.value = errorMessage(error);
    }),
  );
}

watch(
  [() => props.store.current.value, editor],
  async ([next], old) => {
    // Typing in the note that is being left goes into its own document first.
    if (old?.[0] && old[0] !== next && !props.store.deleted.value) await flush().catch(() => undefined);
    bind(next);
  },
  { immediate: true },
);

/** Another panel saved the shown note: take its text unless this panel has typing of its own, which then wins on its next save. */
const stopFollowing = props.store.onChange((change) => {
  const instance = editor.value;
  if (!instance || change.id !== boundId) return;
  if (change.deleted) {
    // It stays open, but nothing typed now would be kept: the banner offers to bring it back.
    clearTimeout(timer);
    timer = undefined;
    instance.setEditable(false, false);
    return;
  }
  if (change.source !== "remote" || busy()) return;
  const { from, to } = instance.state.selection;
  if (!titleFocused) titleDraft.value = change.data.title;
  showContent(instance, change.data);
  const end = instance.state.doc.content.size;
  instance.commands.setTextSelection({ from: Math.min(from, end), to: Math.min(to, end) });
});

/** Brings a note deleted elsewhere back; the editor then holds the new document. */
async function restoreDeleted() {
  try {
    await props.store.restoreDeleted();
  } catch (error) {
    emit("notice", t("editor.restoreFailed", { error: errorMessage(error) }));
  }
}

/** Shows the document's text again, e.g. after the scratchpad was cleared or Undo brought it back. */
function reload() {
  const instance = editor.value;
  if (!instance || !handle) return;
  contentDirty = false;
  titleDirty = false;
  showContent(instance, handle.data);
  titleDraft.value = handle.data.title;
}

function onTitleInput() {
  if (!handle || props.store.deleted.value) return;
  titleDirty = true;
  saveState.value = "pending";
  schedule();
}

function onTitleFocus() {
  titleFocused = true;
}

function onTitleBlur() {
  titleFocused = false;
  void flush().catch(() => undefined);
}

/** Another panel or the list renamed the note: show its title, unless this field is being typed in. */
watch(
  () => props.entry?.fixedTitle,
  (title) => {
    if (title === undefined || titleFocused || busy()) return;
    if (boundId === props.noteId) titleDraft.value = title;
  },
);

/** The first-line title, shown greyed out in the empty title field. */
const derivedTitle = computed(() => {
  const title = titleFor(props.noteId, props.entry?.text ?? "");
  return title === UNTITLED ? t("untitled") : title;
});

/** Puts the cursor in the note once it has loaded. */
async function focus() {
  await nextTick();
  editor.value?.commands.focus("end");
}

defineExpose({ flush, focus, reload });

onBeforeUnmount(() => {
  stopFollowing();
  void flush().catch(() => undefined);
  for (const off of unbind.splice(0)) off();
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
  // Only web addresses open in the Browser; Ctrl+click on a mailto: link shows its bar like a plain click.
  if ((event.ctrlKey || event.metaKey) && /^https?:/i.test(href)) {
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
  // Escape closes the larger picture first, and nothing else.
  if (lightbox.value) return;
  if (event.key === "Escape" && imageBar.value) {
    event.stopPropagation();
    editor.value?.commands.setTextSelection(editor.value.state.selection.to);
    return;
  }
  if (event.key === "Escape" && linkPopover.value) {
    event.stopPropagation();
    linkPopover.value = null;
  }
}

// While Ctrl (or Cmd) is held, links show the hand cursor: a click opens them.
const ctrlHeld = ref(false);

function onModifierKey(event: KeyboardEvent) {
  ctrlHeld.value = event.ctrlKey || event.metaKey;
}

function onWindowBlur() {
  ctrlHeld.value = false;
}

onMounted(() => {
  addEventListener("pointerdown", closeLinkPopover, true);
  addEventListener("keydown", onLinkKey, true);
  addEventListener("keydown", onModifierKey);
  addEventListener("keyup", onModifierKey);
  addEventListener("blur", onWindowBlur);
});
onBeforeUnmount(() => {
  removeEventListener("pointerdown", closeLinkPopover, true);
  removeEventListener("keydown", onLinkKey, true);
  removeEventListener("keydown", onModifierKey);
  removeEventListener("keyup", onModifierKey);
  removeEventListener("blur", onWindowBlur);
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
const room = computed(() => width.value - (props.narrow ? 40 : 0) - (props.noteId === SCRATCHPAD_ID ? 64 : 0) - 64);

const lookVars = computed(() => ({ "--note-font": fontStack(props.look.font), "--note-size": `${sizePx(props.look.size)}px` }));
const shownGroups = computed(() =>
  toolGroups.value.map((group) => group.filter((tool) => tool.minWidth <= room.value)).filter((group) => group.length),
);
const moreTools = computed(() => toolGroups.value.flat().filter((tool) => tool.minWidth > room.value));

const scratchpadEmpty = computed(() => editor.value?.isEmpty ?? true);

const statusText = (state: SaveState): string => (state === "idle" ? "" : t(`save.${state}`));
</script>

<template>
  <section ref="root" class="flex h-full min-w-0 flex-col" :data-ctrl="ctrlHeld" :aria-label="t('editor.note')" data-testid="note-editor" :data-loaded="loadedNote ?? ''">
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
        <PanelLeftOpen :stroke-width="1.5" />
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
        <DropdownMenu @update:open="refreshImageUsage">
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="icon-sm" class="flex-none" data-testid="insert-image" :aria-label="t('image.insert')" :title="t('image.insert')">
              <ImagePlus :stroke-width="1.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" class="min-w-60">
            <DropdownMenuItem data-testid="image-choose" @select="fileInput?.click()">{{ t("image.choose") }}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{{ t("image.quality") }}</DropdownMenuLabel>
            <DropdownMenuItem v-for="quality in (['optimized', 'original'] as const)" :key="quality" :data-testid="`quality-${quality}`" @select.prevent="store.setImageQuality(quality)">
              <span class="flex flex-col">
                <span>{{ t(`image.${quality}`) }}</span>
                <span class="text-muted-foreground text-xs">{{ t(`image.${quality}Hint`) }}</span>
              </span>
              <Check v-if="store.imageQuality.value === quality" class="ml-auto" :stroke-width="1.5" :aria-label="t('editor.on')" />
            </DropdownMenuItem>
            <template v-if="imageUsage">
              <DropdownMenuSeparator />
              <p class="text-muted-foreground px-2 py-1.5 text-xs" data-testid="image-usage">{{ t("image.usage", { used: formatMegabytes(imageUsage.bytes), total: formatMegabytes(imageUsage.maxBytes) }) }}</p>
            </template>
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
      >{{ adding > 0 ? t("image.adding") : statusText(saveState) }}</span>
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
    <div v-if="store.deleted.value" class="bg-muted flex flex-none items-center gap-2 border-b px-3 py-1.5 text-sm" role="status" data-testid="deleted-banner">
      <span class="text-muted-foreground min-w-0 flex-1 truncate">{{ t("editor.deleted") }}</span>
      <Button variant="outline" size="sm" data-testid="restore-note" @click="restoreDeleted">{{ t("editor.restore") }}</Button>
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto" :style="lookVars" @scroll.passive="(linkPopover = null), updateImageBar()">
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
    <input ref="fileInput" type="file" multiple class="hidden" :accept="store.acceptAttribute" data-testid="image-file" @change="onFilePicked" />
    <ImageBar v-if="imageBar" v-bind="imageBar" @set="setImage" @open="openSelectedImage" @remove="removeSelectedImage" />
    <ImageLightbox v-if="lightbox" :src="store.blobUrl(lightbox)" @close="lightbox = null" />
    <LinkPopover v-if="linkPopover" v-bind="linkPopover" @open="popoverOpen" @edit="popoverEdit" @remove="popoverRemove" />
    <LinkDialog v-if="linkOpen" :initial="currentLink" @apply="applyLink" @cancel="linkOpen = false" />
  </section>
</template>

<style>
.note-content {
  /* Contains the pictures the text flows around. */
  display: flow-root;
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
[data-ctrl="true"] .note-content a {
  cursor: pointer;
}
.note-content a {
  color: var(--primary);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.note-image {
  position: relative;
  display: block;
  max-width: 100%;
  margin: 4px 0;
  border-radius: 6px;
  line-height: 0;
}
.note-image img {
  display: block;
  width: 100%;
  height: auto;
  border-radius: 6px;
}
.note-image[data-mode="left"] {
  float: left;
  margin: 4px 14px 8px 0;
}
.note-image[data-mode="right"] {
  float: right;
  margin: 4px 0 8px 14px;
}
.note-image-selected {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.note-image-handle {
  position: absolute;
  right: -4px;
  bottom: -4px;
  display: none;
  width: 12px;
  height: 12px;
  border-radius: 3px;
  background: var(--primary);
  cursor: nwse-resize;
  touch-action: none;
}
.note-image-selected .note-image-handle {
  display: block;
}
.note-image-missing {
  min-width: 96px;
  min-height: 64px;
  background: var(--muted);
}
.note-image-missing img {
  visibility: hidden;
  height: 64px;
}
.note-image-missing::after {
  content: "";
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
