// @vitest-environment jsdom
// The script of a Stream overlay's frame page (overlays.ts overlayFrame), run on the page it comes with.
import { afterEach, describe, expect, it, vi } from "vitest";
import { OVERLAY_COLOR_SCHEME_MESSAGE, OVERLAY_CSS_MESSAGE } from "@tavora/sdk/protocol";
import { overlayFrame, overlayPageOrigin } from "./overlays";

const PORT = 47820;
const TOKEN = "a".repeat(32);

/** The frame page as OBS gets it, with its script run; the frame's window is the page's. */
function frame(hash = "") {
  const { html } = overlayFrame(PORT, TOKEN, "?x=1");
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const script = parsed.querySelector("script")!.textContent!;
  parsed.querySelector("script")!.remove();
  document.head.replaceChildren(...Array.from(parsed.head.childNodes).map((node) => document.importNode(node, true)));
  document.body.replaceChildren(...Array.from(parsed.body.childNodes).map((node) => document.importNode(node, true)));
  window.location.hash = hash;
  const iframe = document.getElementById("page") as HTMLIFrameElement;
  new Function(script)();
  // After the script gave the frame its address (jsdom makes a new window then; a browser keeps the same one).
  const posted = vi.spyOn(iframe.contentWindow!, "postMessage").mockImplementation(() => undefined);
  const fromPage = (data: unknown) => window.dispatchEvent(new MessageEvent("message", { source: iframe.contentWindow, data }));
  return { iframe, posted, fromPage };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.restoreAllMocks();
  document.head.replaceChildren();
  document.body.replaceChildren();
});

describe("a Stream overlay's frame page", () => {
  it("loads the module's page with the link's query and #…", () => {
    const { iframe } = frame("#big");
    expect(iframe.getAttribute("src")).toBe(`${overlayPageOrigin(PORT, TOKEN)}/?x=1#big`);
  });

  it("takes on the colour scheme the page reports, and only from the page", () => {
    const { iframe, fromPage } = frame();
    window.dispatchEvent(new MessageEvent("message", { source: window, data: { type: OVERLAY_COLOR_SCHEME_MESSAGE, colorScheme: "dark" } }));
    expect(iframe.style.colorScheme).toBe("");
    fromPage({ type: OVERLAY_COLOR_SCHEME_MESSAGE, colorScheme: "dark; background: red" });
    expect(iframe.style.colorScheme).toBe("");
    fromPage({ type: OVERLAY_COLOR_SCHEME_MESSAGE, colorScheme: "dark" });
    expect(iframe.style.colorScheme).toBe("dark");
  });

  it("passes OBS's Custom CSS on to the page's origin only, when it comes and when the page asks", async () => {
    const { posted, fromPage } = frame();
    // OBS adds its Custom CSS as a <style> once the page has loaded.
    const style = document.createElement("style");
    style.textContent = "body { background-color: rgba(0, 0, 0, 0); margin: 0px auto; overflow: hidden; }";
    document.head.append(style);
    await settle();
    const page = overlayPageOrigin(PORT, TOKEN);
    expect(posted).toHaveBeenLastCalledWith({ type: OVERLAY_CSS_MESSAGE, css: style.textContent }, page);
    // The frame's own style never goes along.
    expect(posted.mock.calls.every(([message]) => !(message as { css: string }).css.includes("iframe{"))).toBe(true);

    // A page that (re)loads says its scheme; it gets the CSS again.
    posted.mockClear();
    fromPage({ type: OVERLAY_COLOR_SCHEME_MESSAGE, colorScheme: "normal" });
    expect(posted).toHaveBeenCalledWith({ type: OVERLAY_CSS_MESSAGE, css: style.textContent }, page);

    // The user changes it in OBS.
    posted.mockClear();
    style.textContent = "body { zoom: 2 }";
    await settle();
    expect(posted).toHaveBeenCalledWith({ type: OVERLAY_CSS_MESSAGE, css: "body { zoom: 2 }" }, page);
  });
});
