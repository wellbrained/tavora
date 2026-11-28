// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { dropsFolder, guardPickerEvents, lockPickersInMainWorld } from "./file-pickers";

const fileInput = (connected = true) => {
  const input = document.createElement("input");
  input.type = "file";
  if (connected) document.body.append(input);
  return input;
};

/** Every click that reaches the input: whether it would still open the picker when its dispatch ends. */
const watch = (input: HTMLElement) => {
  const seen: boolean[] = [];
  input.addEventListener("click", (event) => queueMicrotask(() => seen.push(!event.defaultPrevented)));
  return seen;
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("a module page and the system's file picker", () => {
  const showPicker = vi.fn();
  const nativeDispatch = EventTarget.prototype.dispatchEvent;
  beforeAll(() => {
    // jsdom has no showPicker and no File System Access pickers; the page's world has both.
    Object.defineProperty(HTMLInputElement.prototype, "showPicker", { value: showPicker, writable: true, configurable: true, enumerable: true });
    for (const name of ["showOpenFilePicker", "showSaveFilePicker", "showDirectoryPicker"]) {
      Object.defineProperty(window, name, { value: vi.fn(), writable: true, configurable: true, enumerable: true });
    }
    lockPickersInMainWorld();
    guardPickerEvents(window);
  });

  it("cancels a click on a file input in the document, the user's or a label's", async () => {
    const input = fileInput();
    const seen = watch(input);
    // As a real click: sent past the page's own dispatchEvent, so only the isolated world's listener can stop it.
    nativeDispatch.call(input, new MouseEvent("click", { bubbles: true, cancelable: true }));
    const label = document.createElement("label");
    const inner = document.createElement("span");
    label.append(inner, fileInput(false));
    document.body.append(label);
    const seenLabelled = watch(label.querySelector("input")!);
    nativeDispatch.call(inner, new MouseEvent("click", { bubbles: true, cancelable: true }));
    await settle();
    expect(seen).toEqual([false]);
    expect(seenLabelled).toEqual([false]);
  });

  it("cancels the activation of an input that turned into a file input during its click", () => {
    const input = document.createElement("input");
    document.body.append(input);
    input.addEventListener("click", () => (input.type = "file"));
    input.click();
    // Chromium opens the picker from the DOMActivate that follows a click no one cancelled.
    const activate = new UIEvent("DOMActivate", { bubbles: true, cancelable: true });
    nativeDispatch.call(input, activate);
    expect(input.type).toBe("file");
    expect(activate.defaultPrevented).toBe(true);
  });

  it("sends no click to an input or a label outside the document", () => {
    const text = document.createElement("input");
    const clicks: string[] = [];
    text.addEventListener("click", () => clicks.push("text"));
    text.click();
    expect(text.dispatchEvent(new MouseEvent("click"))).toBe(false);
    const other = document.implementation.createHTMLDocument("");
    const elsewhere = other.createElement("input");
    other.body.append(elsewhere);
    elsewhere.addEventListener("click", () => clicks.push("elsewhere"));
    elsewhere.click();
    expect(clicks).toEqual([]);
  });

  it("sends no click to a file input, or a label for one, from a script", async () => {
    for (const connected of [true, false]) {
      const input = fileInput(connected);
      const seen = watch(input);
      input.click();
      expect(input.dispatchEvent(new MouseEvent("click", { cancelable: true }))).toBe(false);
      const label = document.createElement("label");
      const inner = document.createElement("span");
      label.append(inner, fileInput(false));
      if (connected) document.body.append(label);
      const seenLabelled = watch(label.querySelector("input")!);
      label.click();
      inner.click();
      inner.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await settle();
      expect(seen, `connected: ${connected}`).toEqual([]);
      expect(seenLabelled, `connected: ${connected}`).toEqual([]);
    }
  });

  it("refuses showPicker for a file input only", () => {
    expect(() => fileInput(false).showPicker()).toThrow(expect.objectContaining({ name: "NotAllowedError" }));
    const date = document.createElement("input");
    date.type = "date";
    date.showPicker();
    expect(showPicker).toHaveBeenCalledTimes(1);
  });

  it("has no File System Access pickers", () => {
    for (const name of ["showOpenFilePicker", "showSaveFilePicker", "showDirectoryPicker"]) expect(name in window, name).toBe(false);
  });

  it("still clicks and dispatches everything else", () => {
    const button = document.createElement("button");
    const text = fileInput();
    text.type = "text";
    document.body.append(button);
    const clicks: string[] = [];
    for (const element of [button, text]) element.addEventListener("click", () => clicks.push(element.tagName));
    button.click();
    text.click();
    expect(button.dispatchEvent(new MouseEvent("click", { cancelable: true }))).toBe(true);
    expect(clicks).toEqual(["BUTTON", "INPUT", "BUTTON"]);
  });
});

describe("dropping on a module page", () => {
  const transfer = (...entries: ({ isDirectory: boolean } | null)[]) =>
    ({ items: entries.map((entry) => ({ kind: "file", webkitGetAsEntry: () => entry })) }) as unknown as DataTransfer;

  it("refuses a drop with a folder in it", () => {
    expect(dropsFolder(transfer({ isDirectory: false }, { isDirectory: true }))).toBe(true);
  });

  it("lets files and text through", () => {
    expect(dropsFolder(transfer({ isDirectory: false }))).toBe(false);
    expect(dropsFolder(transfer(null))).toBe(false);
    expect(dropsFolder({ items: [{ kind: "string" }] } as unknown as DataTransfer)).toBe(false);
    expect(dropsFolder(null)).toBe(false);
  });
});
