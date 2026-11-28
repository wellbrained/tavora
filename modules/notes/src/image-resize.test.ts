// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { textExtensions } from "./textExtensions";
import { ImageNode } from "./ImageNode";

// Dragging a picture's corner resizes it. Letting go keeps the width; a pointer the system takes away (pointercancel) puts
// the picture back at the width it had and changes nothing in the note.

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

const pointer = (type: string, x = 0) => Object.assign(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x }), { pointerId: 1 });

function setup() {
  Object.defineProperty(Element.prototype, "setPointerCapture", { configurable: true, value: () => undefined });
  Object.defineProperty(Element.prototype, "hasPointerCapture", { configurable: true, value: () => false });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 400 });
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: [...textExtensions(), ImageNode.configure({ url: (id) => `blob:${id}`, onOpen: () => undefined })],
    content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "image", attrs: { blobId: "b1", mode: "block", width: 50 } }] }] },
  });
  editors.push(editor);
  const image = element.querySelector(".note-image") as HTMLElement;
  image.getBoundingClientRect = () => new DOMRect(0, 0, 200, 100);
  const handle = element.querySelector(".note-image-handle") as HTMLElement;
  const widthOf = () => (editor.getJSON().content?.[0]?.content?.[0] as { attrs: { width: number | null } }).attrs.width;
  return { handle, image, widthOf };
}

describe("resizing a picture", () => {
  it("keeps the new width when the pointer is let go", () => {
    const { handle, image, widthOf } = setup();
    handle.dispatchEvent(pointer("pointerdown", 100));
    handle.dispatchEvent(pointer("pointermove", 180));
    expect(image.style.width).toBe("70%");
    handle.dispatchEvent(pointer("pointerup", 180));
    expect(widthOf()).toBe(70);
  });

  it("goes back to its width, and the note stays as it was, when the system takes the pointer away", () => {
    const { handle, image, widthOf } = setup();
    handle.dispatchEvent(pointer("pointerdown", 100));
    handle.dispatchEvent(pointer("pointermove", 180));
    handle.dispatchEvent(pointer("pointercancel"));
    expect(widthOf()).toBe(50);
    expect(image.style.width).toBe("50%");
  });
});
