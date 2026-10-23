import { describe, expect, it } from "vitest";
import { makePng } from "./clipboard-http.test";
import { cleanPictureName, freeFileName, servePictureSave, type PictureSaveDeps } from "./picture-save-http";

describe("cleanPictureName", () => {
  it("keeps a plain name", () => {
    expect(cleanPictureName("Board 1 2026-10-17 21-47")).toBe("Board 1 2026-10-17 21-47");
  });

  it("takes out what a file name cannot hold, and never leaves a path", () => {
    expect(cleanPictureName('..\\..\\Windows/sys:tem*?"<>|')).toBe("Windows sys tem");
    expect(cleanPictureName("a\u0000b\nc")).toBe("a b c");
    expect(cleanPictureName(".hidden.")).toBe("hidden");
  });

  it("falls back to Picture for nothing or a reserved Windows name", () => {
    expect(cleanPictureName("")).toBe("Picture");
    expect(cleanPictureName(" ... ")).toBe("Picture");
    expect(cleanPictureName("CON")).toBe("Picture");
    expect(cleanPictureName("x".repeat(200))).toHaveLength(80);
  });
});

describe("freeFileName", () => {
  it("adds a number rather than reuse a name", () => {
    const taken = new Set(["Board.png", "Board (2).png"]);
    expect(freeFileName("Board", (name) => taken.has(name))).toBe("Board (3).png");
    expect(freeFileName("New", (name) => taken.has(name))).toBe("New.png");
  });
});

describe("servePictureSave", () => {
  function deps(allowed = true, closed = false) {
    const state = { allowed, saved: [] as { png: Buffer; name: string }[] };
    const value: PictureSaveDeps = {
      allowed: () => state.allowed,
      consume: () => void (state.allowed = false),
      save: async (png, name) => {
        if (closed) return null;
        state.saved.push({ png, name });
        return `${name}.png`;
      },
    };
    return { state, value };
  }
  const post = (body: Uint8Array | null, name = "Board 1") => {
    const url = new URL(`tavora-module://notes/_pictures/?name=${encodeURIComponent(name)}`);
    return { request: new Request(url, { method: "POST", body: body as unknown as BodyInit }), url };
  };

  it("saves a PNG after a click under a cleaned name, once per click", async () => {
    const { state, value } = deps();
    const png = makePng(20, 20);
    const first = post(png, "Board/1");
    const response = await servePictureSave(first.request, first.url, value);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ fileName: "Board 1.png" });
    expect(state.saved).toHaveLength(1);
    const again = post(png);
    expect((await servePictureSave(again.request, again.url, value)).status).toBe(403);
  });

  it("answers null when the player closed the save dialog", async () => {
    const { state, value } = deps(true, true);
    const closed = post(makePng(20, 20));
    const response = await servePictureSave(closed.request, closed.url, value);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ fileName: null });
    expect(state.saved).toHaveLength(0);
  });

  it("refuses without a click, and anything but a complete PNG", async () => {
    const without = post(makePng(10, 10));
    expect((await servePictureSave(without.request, without.url, deps(false).value)).status).toBe(403);
    const text = post(new TextEncoder().encode("not a picture at all, only some words"));
    const { state, value } = deps();
    expect((await servePictureSave(text.request, text.url, value)).status).toBe(415);
    expect(state.saved).toHaveLength(0);
    const get = new URL("tavora-module://notes/_pictures/");
    expect((await servePictureSave(new Request(get), get, value)).status).toBe(405);
  });
});
