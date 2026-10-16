// The picture node of a note. A picture is the id of a stored file (see blobs), shown either inline
// with the text, at the height of a line, or on a line of its own at a chosen width. A picture on its
// own line can be resized by dragging its corner.

import { Node } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";

export type ImageMode = "inline" | "block";

export interface ImageAttrs {
  blobId: string;
  mode: ImageMode;
  /** Width on its own line as a percentage of the text width; null for its real size, at most the full width. */
  width: number | null;
}

export interface ImageOptions {
  /** The address to show a stored file from. */
  url(blobId: string): string;
  /** Called on a double click, to show the picture larger. */
  onOpen(blobId: string): void;
}

/** Dragging snaps to steps of this many percent, never below MIN_WIDTH. */
const STEP = 5;
export const MIN_WIDTH = 10;

export function clampWidth(percent: number): number | null {
  const snapped = Math.round(percent / STEP) * STEP;
  if (snapped >= 100) return null;
  return Math.max(MIN_WIDTH, snapped);
}

export const ImageNode = Node.create<ImageOptions>({
  name: "image",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return { url: (blobId) => blobId, onOpen: () => {} };
  },

  addAttributes() {
    return {
      blobId: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-blob-id") ?? "",
        renderHTML: (attributes) => ({ "data-blob-id": attributes.blobId as string }),
      },
      mode: {
        default: "block",
        parseHTML: (element) => (element.getAttribute("data-mode") === "inline" ? "inline" : "block"),
        renderHTML: (attributes) => ({ "data-mode": attributes.mode as string }),
      },
      width: {
        default: null,
        parseHTML: (element) => {
          const width = Number(element.getAttribute("data-width"));
          return Number.isFinite(width) && width > 0 ? width : null;
        },
        renderHTML: (attributes) => (attributes.width === null ? {} : { "data-width": String(attributes.width) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "img[data-blob-id]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["img", { ...HTMLAttributes, src: this.options.url(HTMLAttributes["data-blob-id"] as string) }];
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      let current = node;
      const dom = document.createElement("span");
      dom.className = "note-image";
      const img = document.createElement("img");
      img.draggable = false;
      const handle = document.createElement("span");
      handle.className = "note-image-handle";
      dom.append(img, handle);

      const show = () => {
        const attrs = current.attrs as ImageAttrs;
        dom.dataset.mode = attrs.mode;
        img.alt = "";
        if (img.dataset.blobId !== attrs.blobId) {
          img.dataset.blobId = attrs.blobId;
          dom.classList.remove("note-image-missing");
          img.src = this.options.url(attrs.blobId);
        }
        // A picture is never shown larger than it really is.
        dom.style.width = attrs.mode === "block" && attrs.width !== null ? `${attrs.width}%` : "";
        dom.style.maxWidth = attrs.mode === "block" && dom.dataset.natural ? `${dom.dataset.natural}px` : "";
      };
      img.addEventListener("load", () => {
        dom.dataset.natural = String(img.naturalWidth);
        show();
      });
      img.addEventListener("error", () => dom.classList.add("note-image-missing"));
      dom.addEventListener("dblclick", () => this.options.onOpen((current.attrs as ImageAttrs).blobId));

      // Dragging the corner changes the width of a picture on its own line.
      handle.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const container = editor.view.dom as HTMLElement;
        const total = container.clientWidth - parseFloat(getComputedStyle(container).paddingLeft || "0") - parseFloat(getComputedStyle(container).paddingRight || "0");
        const startX = event.clientX;
        const startWidth = dom.getBoundingClientRect().width;
        let width: number | null = (current.attrs as ImageAttrs).width;
        handle.setPointerCapture(event.pointerId);
        const move = (moveEvent: PointerEvent) => {
          width = clampWidth(((startWidth + moveEvent.clientX - startX) / total) * 100);
          dom.style.width = width === null ? "" : `${width}%`;
        };
        const stop = () => {
          handle.removeEventListener("pointermove", move);
          handle.removeEventListener("pointerup", stop);
          handle.removeEventListener("pointercancel", stop);
          const pos = getPos();
          if (typeof pos !== "number") return;
          const attrs = current.attrs as ImageAttrs;
          if (attrs.width === width) return;
          const tr = editor.state.tr.setNodeMarkup(pos, undefined, { ...attrs, width });
          // Replacing the picture drops the selection; keep it selected.
          editor.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)));
        };
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", stop);
        handle.addEventListener("pointercancel", stop);
      });

      show();
      return {
        dom,
        update: (updated) => {
          if (updated.type !== current.type) return false;
          current = updated;
          show();
          return true;
        },
        selectNode: () => dom.classList.add("note-image-selected"),
        deselectNode: () => dom.classList.remove("note-image-selected"),
        stopEvent: (event) => event.target === handle,
        ignoreMutation: () => true,
      };
    };
  },
});
