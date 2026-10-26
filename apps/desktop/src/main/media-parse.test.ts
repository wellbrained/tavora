import { describe, expect, it } from "vitest";
import { appName, MAX_SESSIONS, parseControlParams, parseHelperLine, parseWatchParams } from "./media-parse";

const SESSION = {
  id: "Spotify.exe#0",
  app: "Spotify.exe",
  current: true,
  title: "Song",
  artist: "Artist",
  album: "Album",
  status: "playing",
  positionMs: 1000,
  positionAt: 1_700_000_000_000,
  durationMs: 200_000,
  canPlayPause: true,
  canNext: true,
  canPrevious: false,
  coverKey: "Song\u001fArtist\u001fAlbum",
};

describe("parseHelperLine", () => {
  it("reads sessions", () => {
    expect(parseHelperLine(JSON.stringify({ type: "sessions", sessions: [SESSION] }))).toEqual({ type: "sessions", sessions: [SESSION] });
  });

  it("takes missing numbers and cover as null", () => {
    const { positionMs, positionAt, durationMs, coverKey, ...rest } = SESSION;
    void positionMs, positionAt, durationMs, coverKey;
    expect(parseHelperLine(JSON.stringify({ type: "sessions", sessions: [rest] }))).toEqual({
      type: "sessions",
      sessions: [{ ...rest, positionMs: null, positionAt: null, durationMs: null, coverKey: null }],
    });
  });

  it.each([
    ["an unknown status", { status: "rewinding" }],
    ["a negative position", { positionMs: -1 }],
    ["a fractional length", { durationMs: 1.5 }],
    ["a missing id", { id: "" }],
    ["a flag that isn't one", { current: "yes" }],
    ["a cover key that isn't text", { coverKey: 5 }],
  ])("leaves out a session with %s", (_, change) => {
    expect(parseHelperLine(JSON.stringify({ type: "sessions", sessions: [{ ...SESSION, ...change }, SESSION] }))).toEqual({ type: "sessions", sessions: [SESSION] });
  });

  it("cuts long texts and too many sessions", () => {
    const line = JSON.stringify({ type: "sessions", sessions: Array.from({ length: 40 }, () => ({ ...SESSION, title: "x".repeat(2000) })) });
    const message = parseHelperLine(line);
    expect(message?.type === "sessions" && message.sessions.length).toBe(MAX_SESSIONS);
    expect(message?.type === "sessions" && message.sessions[0]!.title.length).toBe(500);
  });

  it("reads a cover", () => {
    expect(parseHelperLine(JSON.stringify({ type: "cover", id: "a", key: "k", mime: "image/PNG", data: "iVBORw0KGgo=" }))).toEqual({ type: "cover", id: "a", key: "k", mime: "image/png", data: "iVBORw0KGgo=" });
  });

  it.each([
    { type: "cover", id: "a", key: "k", mime: "text/html", data: "AAAA" },
    { type: "cover", id: "a", key: "k", mime: "image/png", data: "not base64!" },
    { type: "cover", id: "a", key: "k", mime: "image/png", data: "" },
    { type: "cover", id: "a", mime: "image/png", data: "AAAA" },
  ])("refuses the cover %j", (message) => {
    expect(parseHelperLine(JSON.stringify(message))).toBeNull();
  });

  it("reads results, errors and ready", () => {
    expect(parseHelperLine('{"type":"result","req":3,"ok":true}')).toEqual({ type: "result", req: 3, ok: true });
    expect(parseHelperLine('{"type":"error","message":"boom"}')).toEqual({ type: "error", message: "boom" });
    expect(parseHelperLine('{"type":"ready"}')).toEqual({ type: "ready" });
  });

  it.each(["", "not json", "[]", '{"type":"other"}', '{"type":"sessions"}', '{"type":"result","req":"1","ok":true}'])("ignores %j", (line) => {
    expect(parseHelperLine(line)).toBeNull();
  });
});

describe("appName", () => {
  it.each([
    ["Spotify.exe", "Spotify"],
    ["SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify", "Spotify"],
    ["Chrome", "Chrome"],
    ["MSEdge", "Edge"],
    ["308046B0AF4A39CB", "Firefox"],
    ["AppleInc.AppleMusicWin_nzyj5cx40ttqa!App", "Apple Music"],
    ["Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic", "Media Player"],
    ["vlc.exe", "VLC"],
    ["Contoso.CoolPlayer_abc123!App", "Cool Player"],
    ["C:\\Program Files\\thing\\winamp.exe", "Winamp"],
    ["", "Unknown app"],
  ])("names %j %j", (id, name) => {
    expect(appName(id)).toBe(name);
  });
});

describe("params", () => {
  it("checks media.watch", () => {
    expect(parseWatchParams({ on: true })).toBe(true);
    expect(parseWatchParams({ on: false })).toBe(false);
    expect(() => parseWatchParams({ on: "yes" })).toThrow(/on/);
    expect(() => parseWatchParams(null)).toThrow();
  });

  it("checks media.control", () => {
    expect(parseControlParams({ session: "a#0", action: "previous" })).toEqual({ session: "a#0", action: "previous" });
    expect(() => parseControlParams({ session: "a#0", action: "stop" })).toThrow(/action/);
    expect(() => parseControlParams({ session: "x".repeat(1001), action: "next" })).toThrow(/session/);
  });
});
