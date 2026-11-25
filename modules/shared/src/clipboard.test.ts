// @vitest-environment jsdom
import { createMemoryHost } from "@tavora/sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { copyImage, copyText } from "./clipboard";
import { setKitSdk } from "./kit-sdk";

/** The old way's copy, as jsdom has no clipboard: says whether it worked and keeps what the field held. */
function oldWay(works = true) {
  const copied: string[] = [];
  document.execCommand = vi.fn(() => {
    const field = document.querySelector("textarea");
    if (works && field) copied.push(field.value);
    return works;
  }) as typeof document.execCommand;
  return copied;
}

function browserClipboard(writeText: (text: string) => Promise<void>, write: (items: ClipboardItem[]) => Promise<void> = async () => {}) {
  Object.defineProperty(navigator, "clipboard", { value: { writeText, write }, configurable: true });
}

afterEach(() => {
  setKitSdk(undefined);
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("copyText in Tavora", () => {
  it("copies through Tavora, once per click, and passes on a refusal", async () => {
    const { sdk, host } = createMemoryHost({ gestures: "enforce" });
    setKitSdk(sdk);
    const copied = oldWay();
    await host.click(() => copyText("Solved ⚔️"));
    expect(host.calls["clipboard.writeText"]).toEqual([{ text: "Solved ⚔️" }]);
    await expect(copyText("again")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    // A refusal stands: the old way doesn't copy behind Tavora's back.
    expect(copied).toEqual([]);
  });

  it("copies the old way on a Tavora older than clipboard.writeText, and gives the focus back", async () => {
    const { sdk, host } = createMemoryHost({ version: "0.25.19" });
    setKitSdk(sdk);
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    const copied = oldWay();
    await copyText("line one\nline two");
    expect(copied).toEqual(["line one\nline two"]);
    expect(host.calls["clipboard.writeText"]).toBeUndefined();
    expect(document.activeElement).toBe(button);
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("refuses empty text", async () => {
    const { sdk } = createMemoryHost();
    setKitSdk(sdk);
    await expect(copyText("")).rejects.toThrow();
  });
});

describe("copyText outside Tavora", () => {
  it("uses the browser's clipboard, and the old way when that says no", async () => {
    const writes: string[] = [];
    browserClipboard(async (text) => void writes.push(text));
    await copyText("hello");
    expect(writes).toEqual(["hello"]);

    browserClipboard(() => Promise.reject(new Error("denied")));
    const copied = oldWay();
    await copyText("fallback");
    expect(copied).toEqual(["fallback"]);
  });

  it("throws when neither way worked", async () => {
    browserClipboard(() => Promise.reject(new Error("denied")));
    oldWay(false);
    await expect(copyText("nope")).rejects.toThrow();
  });
});

describe("copyImage", () => {
  it("copies through Tavora", async () => {
    const { sdk, host } = createMemoryHost();
    setKitSdk(sdk);
    const png = new Blob([new Uint8Array([1])], { type: "image/png" });
    await copyImage(png);
    expect(host.calls["clipboard.writeImage"]).toEqual([{ png }]);
  });

  it("uses the browser's clipboard outside Tavora", async () => {
    vi.stubGlobal("ClipboardItem", class { constructor(readonly items: Record<string, Blob>) {} });
    const written: unknown[] = [];
    browserClipboard(async () => {}, async (items) => void written.push(...items));
    const png = new Blob([new Uint8Array([1])], { type: "image/png" });
    await copyImage(png);
    expect(written).toEqual([{ items: { "image/png": png } }]);
  });
});
