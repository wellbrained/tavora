// The pictures of the open note: adding them (picked, pasted or dropped), the bar over the selected
// one, and the larger view. NoteEditor.vue wires it to its editor.

import { errorMessage } from "@tavora/official-ui";
import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { ref } from "vue";
import type { ImageAttrs } from "./ImageNode";
import { t } from "./i18n";
import { formatMegabytes } from "./notes";
import { ImageProblem, type NotesStore } from "./store";

/** What the pictures need from the editor around them. */
export interface NoteImagesHost {
  store(): NotesStore;
  /** The editor, once it exists. */
  editor(): Editor | undefined;
  /** The note that is open now; null while none is. A picture added for another note is not inserted. */
  loadedNote(): string | null;
  /** Shows the player a message. */
  notice(message: string): void;
}

export function useNoteImages(host: NoteImagesHost) {
  /** Pictures being stored right now. */
  const adding = ref(0);
  const lightbox = ref<string | null>(null);
  const fileInput = ref<HTMLInputElement | null>(null);
  const imageUsage = ref<{ bytes: number; maxBytes: number } | null>(null);
  /** The bar over the selected picture. */
  const imageBar = ref<{ mode: ImageAttrs["mode"]; width: number | null; left: number; top: number } | null>(null);

  function reportImageProblem(error: unknown) {
    if (!(error instanceof ImageProblem)) return host.notice(t("image.error", { error: errorMessage(error) }));
    if (error.kind === "type") host.notice(t("image.notSupported", { name: error.file }));
    else if (error.kind === "size") host.notice(t("image.tooBig", { name: error.file, max: formatMegabytes(Number(error.message)) }));
    else host.notice(t("image.error", { error: error.message }));
  }

  /** Stores pictures and puts them in the note, one after the other, at `pos` or where the cursor is. */
  async function addImages(files: File[], pos?: number) {
    const instance = host.editor();
    const forNote = host.loadedNote();
    if (!instance || forNote === null) return;
    let at = pos ?? instance.state.selection.to;
    adding.value += files.length;
    try {
      for (const file of files) {
        try {
          const blobId = await host.store().addImage(file);
          // The player may have gone to another note meanwhile; the picture then stays unused and is cleaned up later.
          if (host.loadedNote() !== forNote) continue;
          const size = instance.state.doc.content.size;
          at = Math.min(at, size);
          instance.chain().focus().insertContentAt(at, { type: "image", attrs: { blobId, mode: "block", width: null } satisfies ImageAttrs }).run();
          at = instance.state.selection.to;
        } catch (error) {
          reportImageProblem(error);
        } finally {
          adding.value--;
        }
      }
    } finally {
      adding.value = Math.max(0, adding.value);
    }
  }

  /** Pasted or dropped files: handles the pictures among them, and tells the editor whether it did. */
  function onFiles(list: FileList | null | undefined, event: Event, pos?: number): boolean {
    const files = [...(list ?? [])].filter((file) => file.type.startsWith("image/"));
    if (!files.length) return false;
    event.preventDefault();
    void addImages(files, pos);
    return true;
  }

  function onFilePicked(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = "";
    if (files.length) void addImages(files);
  }

  async function refreshImageUsage(open: boolean) {
    if (!open) return;
    try {
      imageUsage.value = await host.store().imageUsage();
    } catch {
      imageUsage.value = null;
    }
  }

  function updateImageBar() {
    const instance = host.editor();
    const selection = instance?.state.selection;
    if (!instance || !(selection instanceof NodeSelection) || selection.node.type.name !== "image") {
      imageBar.value = null;
      return;
    }
    const dom = instance.view.nodeDOM(selection.from);
    if (!(dom instanceof HTMLElement)) {
      imageBar.value = null;
      return;
    }
    const rect = dom.getBoundingClientRect();
    const attrs = selection.node.attrs as ImageAttrs;
    imageBar.value = { mode: attrs.mode, width: attrs.width, left: rect.left, top: rect.top - 40 < 8 ? rect.bottom + 6 : rect.top - 40 };
  }

  function setImage(patch: Partial<ImageAttrs>) {
    const instance = host.editor();
    const selection = instance?.state.selection;
    if (!(selection instanceof NodeSelection)) return;
    // Replacing the picture drops the selection, so it is selected again for the next change.
    instance?.chain().focus().updateAttributes("image", patch).setNodeSelection(selection.from).run();
  }

  function openSelectedImage() {
    const selection = host.editor()?.state.selection;
    if (selection instanceof NodeSelection && selection.node.type.name === "image") lightbox.value = (selection.node.attrs as ImageAttrs).blobId;
  }

  function removeSelectedImage() {
    host.editor()?.chain().focus().deleteSelection().run();
  }

  return { adding, lightbox, fileInput, imageUsage, imageBar, onFiles, onFilePicked, refreshImageUsage, updateImageBar, setImage, openSelectedImage, removeSelectedImage };
}
