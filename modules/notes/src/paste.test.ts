// @vitest-environment jsdom
import { randomBytes } from "node:crypto";
import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleNotePaste, MAX_PASTE_CHARS, readWhiteboardClip, type PasteHost } from "./paste";
import { textExtensions } from "./textExtensions";

/** A 1×1 PNG. */
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/** What Excalidraw (the Whiteboard, excalidraw.com) puts on the clipboard: JSON as text, no picture. */
function whiteboardCopy(elements: object[], files: Record<string, string> = {}): string {
  return JSON.stringify({
    type: "excalidraw/clipboard",
    elements,
    files: Object.fromEntries(Object.entries(files).map(([id, dataURL]) => [id, { mimeType: "image/png", id, dataURL, created: 1795356437274 }])),
  });
}

const imageElement = (fileId: string, extra: object = {}) => ({ id: `el-${fileId}`, type: "image", fileId, status: "saved", ...extra });

/** Base64 without spaces, like a picture's data: URL: one giant word. */
const base64Text = (chars: number) => randomBytes(Math.ceil((chars * 3) / 4)).toString("base64").slice(0, chars);

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function setup(content?: JSONContent) {
  const host = {
    files: vi.fn(() => false),
    addImages: vi.fn(),
    notice: vi.fn(),
    texts: { tooLong: "too long", drawingOnly: "drawing only" },
  } satisfies PasteHost;
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: textExtensions(),
    content: content ?? { type: "doc", content: [{ type: "paragraph" }] },
    editorProps: { handlePaste: (view, event) => handleNotePaste(view, event, host) },
  });
  editors.push(editor);
  return { editor, host };
}

/** Pastes as Ctrl+V would: the clipboard holds only this text. */
function paste(editor: Editor, text: string) {
  const event = { clipboardData: { getData: (type: string) => (type === "text/plain" ? text : ""), files: [] }, preventDefault: () => undefined };
  editor.view.pasteText(text, event as unknown as ClipboardEvent);
}

describe("readWhiteboardClip", () => {
  it("takes the pictures and texts of a whiteboard's copy, in drawing order", async () => {
    const text = whiteboardCopy(
      [
        { id: "t", type: "text", text: "Base\nlayout", originalText: "Base layout" },
        imageElement("b"),
        imageElement("a"),
        imageElement("gone", { isDeleted: true }),
        { id: "r", type: "rectangle" },
      ],
      { a: `data:image/png;base64,${PNG}`, b: `data:image/png;base64,${PNG}`, gone: `data:image/png;base64,${PNG}` },
    );
    const clip = readWhiteboardClip(text);
    expect(clip?.texts).toEqual(["Base layout"]);
    expect(clip?.pictures.map((file) => [file.name, file.type])).toEqual([
      ["picture-1.png", "image/png"],
      ["picture-2.png", "image/png"],
    ]);
    const bytes = new Uint8Array(await clip!.pictures[0]!.arrayBuffer());
    expect(Buffer.from(bytes).toString("base64")).toBe(PNG);
  });

  it("leaves other text alone", () => {
    expect(readWhiteboardClip("Iron 12")).toBeNull();
    expect(readWhiteboardClip('{"type":"excalidraw/clipboard",')).toBeNull();
    expect(readWhiteboardClip('{"type":"excalidraw","elements":[]}')).toBeNull();
  });

  it("skips a picture that isn't a data: URL", () => {
    const clip = readWhiteboardClip(whiteboardCopy([imageElement("a")], { a: "https://example.com/a.png" }));
    expect(clip).toEqual({ pictures: [], texts: [] });
  });
});

describe("pasting into a note", () => {
  it("adds a whiteboard's pictures as pictures, not their text", () => {
    const { editor, host } = setup();
    paste(editor, whiteboardCopy([imageElement("a")], { a: `data:image/png;base64,${PNG}` }));
    expect(host.addImages).toHaveBeenCalledTimes(1);
    expect(host.addImages.mock.calls[0]![0].map((file: File) => file.type)).toEqual(["image/png"]);
    expect(editor.getText()).toBe("");
  });

  it("keeps the texts of a whiteboard's copy", () => {
    const { editor, host } = setup();
    paste(editor, whiteboardCopy([{ id: "t", type: "text", text: "Iron mine", originalText: "Iron mine" }]));
    expect(editor.getText()).toBe("Iron mine");
    expect(host.addImages).not.toHaveBeenCalled();
    expect(host.notice).not.toHaveBeenCalled();
  });

  it("says so when a whiteboard's copy has only shapes", () => {
    const { editor, host } = setup();
    paste(editor, whiteboardCopy([{ id: "r", type: "rectangle" }]));
    expect(host.notice).toHaveBeenCalledWith("drawing only");
    expect(editor.getText()).toBe("");
  });

  it("refuses text too long for a note, and keeps the note as it was", () => {
    const { editor, host } = setup({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Keep me" }] }] });
    paste(editor, "x".repeat(MAX_PASTE_CHARS + 1));
    expect(host.notice).toHaveBeenCalledWith("too long");
    expect(editor.getText()).toBe("Keep me");
  });

  it("pastes long text without spaces at once, instead of freezing on looking for links", () => {
    const { editor } = setup();
    const text = base64Text(MAX_PASTE_CHARS - 50_000);
    const started = performance.now();
    paste(editor, text);
    expect(performance.now() - started).toBeLessThan(1500);
    expect(editor.getText()).toBe(text);
  });

  it("keeps the lines of long pasted text", () => {
    const { editor } = setup();
    const lines = Array.from({ length: 30_000 }, (_, i) => `Line ${i}`);
    paste(editor, lines.join("\r\n"));
    expect(editor.getText({ blockSeparator: "\n" })).toBe(lines.join("\n"));
  });

  it("pastes dotted text without spaces at once, though it is shorter than long text", () => {
    // Minified code and long dotted chains: the link finder is about quadratic on them (40k took 5.8 s).
    const { editor } = setup();
    const text = "a.".repeat(20_000);
    const started = performance.now();
    paste(editor, text);
    expect(performance.now() - started).toBeLessThan(1500);
    expect(editor.getText()).toBe(text);
  });

  it("refuses a whiteboard's texts too long for a note, but keeps its pictures", () => {
    const { editor, host } = setup();
    paste(editor, whiteboardCopy([{ id: "t", type: "text", text: "x".repeat(MAX_PASTE_CHARS + 1) }, imageElement("a")], { a: `data:image/png;base64,${PNG}` }));
    expect(host.notice).toHaveBeenCalledWith("too long");
    expect(host.addImages).toHaveBeenCalledTimes(1);
    expect(editor.getText()).toBe("");
  });

  it("leaves out picture kinds a note can't hold, and says it's only a drawing", () => {
    const { editor, host } = setup();
    paste(editor, whiteboardCopy([imageElement("a")], { a: `data:image/svg+xml;base64,${btoa("<svg/>")}` }));
    expect(host.addImages).not.toHaveBeenCalled();
    expect(host.notice).toHaveBeenCalledWith("drawing only");
    expect(editor.getText()).toBe("");
  });

  it("still turns a short pasted address into a link", () => {
    const { editor } = setup();
    paste(editor, "https://tavora.gg");
    expect(JSON.stringify(editor.getJSON())).toContain('"href":"https://tavora.gg"');
  });
});

describe("a note that already holds a pasted picture's text", () => {
  // The scratchpad from the report: one paragraph of 1.5 MB base64.
  const giant = () => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: base64Text(1_500_000) }] }] });

  it("can be typed in after it, with spaces and new lines, without freezing", () => {
    const { editor } = setup(giant());
    const started = performance.now();
    editor.chain().focus("end").insertContent(" ").run();
    editor.commands.splitBlock();
    editor.commands.insertContent("ok ");
    expect(performance.now() - started).toBeLessThan(1500);
    expect(editor.getText({ blockSeparator: "\n" }).endsWith(" \nok ")).toBe(true);
  });

  it("can be typed in after a long dotted word in a short paragraph, without freezing", () => {
    const { editor } = setup({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "a.".repeat(9_500) }] }] });
    const started = performance.now();
    editor.chain().focus("end").insertContent(" ").run();
    editor.commands.insertContent("ok ");
    expect(performance.now() - started).toBeLessThan(500);
    expect(editor.getText().endsWith(" ok ")).toBe(true);
  });

  it("still links an address typed in a short paragraph", () => {
    const { editor } = setup();
    editor.chain().focus("end").insertContent("see tavora.gg").run();
    editor.commands.insertContent(" ");
    expect(JSON.stringify(editor.getJSON())).toContain('"href":"https://tavora.gg"');
  });
});
