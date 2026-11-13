import { FiltersEngine } from "@ghostery/adblocker";
import { describe, expect, it } from "vitest";
import { adBlocker, judgedTopUrl, judgeRequest, loadAdBlocker } from "./browser-filter";

const ads = adBlocker(FiltersEngine.parse(["||ads.example^", "||tracker.example^$third-party", "@@||ads.example/allowed.js"].join("\n")));
const on = () => true;
const judge = (url: string, resourceType: string, topUrl: string | null = "https://wiki.example.com/page") => judgeRequest({ url, resourceType, topUrl }, ads, on);

describe("judgeRequest", () => {
  it("allows only web schemes", () => {
    expect(judge("https://cdn.example.com/a.js", "script")).toBe("allow");
    expect(judge("wss://chat.example.com/", "webSocket")).toBe("allow");
    for (const url of ["file:///etc/passwd", "tavora-module://tavora.notes/dist/index.html", "chrome://gpu/", "steam://run/1", "not a url"]) {
      expect(judge(url, "mainFrame"), url).toBe("scheme");
      expect(judge(url, "image"), url).toBe("scheme");
    }
  });

  it("keeps public pages off this PC and the local network", () => {
    expect(judge("http://127.0.0.1:8080/api", "xhr")).toBe("private");
    expect(judge("http://192.168.1.1/", "subFrame")).toBe("private");
    expect(judge("http://router.local/", "image")).toBe("private");
    expect(judge("http://127.0.0.1:8080/api", "xhr", null)).toBe("private");
    // A local page the user opened may use local addresses.
    expect(judge("http://127.0.0.1:8080/api", "xhr", "http://localhost:8080/")).toBe("allow");
    // The page the user asked for is decided by the navigation checks.
    expect(judge("http://127.0.0.1:8080/", "mainFrame")).toBe("allow");
  });

  it("blocks ads and trackers, but never the page itself", () => {
    expect(judge("https://ads.example/banner.js", "script")).toBe("ad");
    expect(judge("https://ads.example/allowed.js", "script")).toBe("allow");
    expect(judge("https://tracker.example/p.gif", "image")).toBe("ad");
    expect(judge("https://ads.example/", "mainFrame")).toBe("allow");
  });

  it("lets ads through where the user turned blocking off, or without an engine", () => {
    expect(judgeRequest({ url: "https://ads.example/b.js", resourceType: "script", topUrl: "https://a.com/" }, ads, () => false)).toBe("allow");
    expect(judgeRequest({ url: "https://ads.example/b.js", resourceType: "script", topUrl: "https://a.com/" }, null, on)).toBe("allow");
  });
});

describe("judgedTopUrl", () => {
  it("judges by a public page the panel is going to, before it commits", () => {
    expect(judgedTopUrl("http://localhost:8080/", "https://example.com/")).toBe("https://example.com/");
    // So a local request then is refused, though the page shown is still the local one.
    expect(judge("http://127.0.0.1:8080/api", "xhr", judgedTopUrl("http://localhost:8080/", "https://example.com/"))).toBe("private");
  });

  it("judges by the page shown while no navigation is under way, or one goes to a local page", () => {
    expect(judgedTopUrl("http://localhost:8080/", null)).toBe("http://localhost:8080/");
    expect(judgedTopUrl("https://example.com/", "http://192.168.1.1/")).toBe("https://example.com/");
    expect(judgedTopUrl(null, null)).toBeNull();
  });
});

describe("loadAdBlocker", () => {
  it("returns null for a missing or broken engine file", () => {
    expect(loadAdBlocker("/nonexistent/engine.bin")).toBeNull();
  });
});
