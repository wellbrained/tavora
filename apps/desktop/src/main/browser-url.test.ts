import { describe, expect, it } from "vitest";
import { addressToUrl, displayHost, isPrivateHost, isPrivateUrl, isSite, isWebUrl, SEARCH_URL, siteOf, siteOfUrl } from "./browser-url";

const search = (text: string) => SEARCH_URL + encodeURIComponent(text);

describe("addressToUrl", () => {
  it("keeps http and https addresses", () => {
    expect(addressToUrl("https://poe2db.tw/us/")).toBe("https://poe2db.tw/us/");
    expect(addressToUrl("  HTTP://Example.com/a b ")).toBe("http://example.com/a%20b");
  });

  it("adds https to host names and http to local ones", () => {
    expect(addressToUrl("satisfactory.wiki.gg")).toBe("https://satisfactory.wiki.gg/");
    expect(addressToUrl("maxroll.gg/poe2/build-guides?x=1")).toBe("https://maxroll.gg/poe2/build-guides?x=1");
    expect(addressToUrl("localhost:3000")).toBe("http://localhost:3000/");
    expect(addressToUrl("192.168.1.20:8080/status")).toBe("http://192.168.1.20:8080/status");
    expect(addressToUrl("[::1]:9000")).toBe("http://[::1]:9000/");
  });

  it("searches everything else, including other schemes", () => {
    for (const text of ["best ranger build", "javascript:alert(1)", "file:///etc/passwd", "steam://run/730", "tavora-module://tavora.notes/", "data:text/html,hi", "wiki", "about:blank"]) {
      expect(addressToUrl(text), text).toBe(search(text));
    }
  });

  it("refuses nothing typed and anything too long", () => {
    expect(addressToUrl("   ")).toBeNull();
    expect(addressToUrl(`https://a.com/${"x".repeat(2100)}`)).toBeNull();
  });
});

describe("isWebUrl", () => {
  it("accepts only http and https with a host", () => {
    expect(isWebUrl("https://a.com/")).toBe(true);
    expect(isWebUrl("http://127.0.0.1:80/")).toBe(true);
    for (const url of ["file:///C:/", "javascript:alert(1)", "data:text/html,x", "blob:https://a.com/x", "chrome://gpu", "devtools://devtools", "tavora-module://x/", "steam://run/1", "about:blank", "nonsense"]) {
      expect(isWebUrl(url), url).toBe(false);
    }
  });
});

describe("isPrivateHost", () => {
  it("knows loopback, private and link-local addresses and local names", () => {
    for (const host of ["localhost", "app.localhost", "printer.local", "127.0.0.1", "127.8.9.1", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.0.1", "169.254.1.1", "100.64.0.1", "0.0.0.0", "[::1]", "[::]", "[fd12::1]", "[fe80::1]", "[::ffff:7f00:1]", "[::ffff:c0a8:101]"]) {
      expect(isPrivateHost(host), host).toBe(true);
    }
  });

  it("treats everything else as public", () => {
    for (const host of ["example.com", "8.8.8.8", "172.32.0.1", "192.169.0.1", "100.128.0.1", "[2001:db8::1]", "[::ffff:808:808]", "local.example.com"]) {
      expect(isPrivateHost(host), host).toBe(false);
    }
  });

  it("sees through the number forms the URL parser normalises", () => {
    expect(isPrivateUrl("http://2130706433/")).toBe(true);
    expect(isPrivateUrl("http://0x7f.1/")).toBe(true);
    expect(isPrivateUrl("http://[0:0:0:0:0:0:0:1]/")).toBe(true);
  });
});

describe("sites", () => {
  it("are registrable domains", () => {
    expect(siteOf("accounts.google.com")).toBe("google.com");
    expect(siteOf("wiki.example.co.uk")).toBe("example.co.uk");
    expect(siteOf("WWW.Fandom.com.")).toBe("fandom.com");
    expect(siteOf("someone.github.io")).toBe("someone.github.io");
    expect(siteOf("localhost")).toBe("localhost");
    expect(siteOf("192.168.1.1")).toBe("192.168.1.1");
    expect(siteOfUrl("https://www.poe2db.tw/us/")).toBe("poe2db.tw");
    expect(siteOfUrl("file:///x")).toBeNull();
  });

  it("are checked when read back", () => {
    expect(isSite("google.com")).toBe(true);
    expect(isSite("localhost")).toBe(true);
    for (const value of ["accounts.google.com", "Google.com", "", "a b.com", "evil.com/path", 5, null, "x".repeat(300)]) {
      expect(isSite(value), String(value)).toBe(false);
    }
  });
});

describe("displayHost", () => {
  it("shows Latin names readably and other scripts as punycode", () => {
    expect(displayHost(new URL("https://müller.de/").hostname)).toBe("müller.de");
    expect(displayHost(new URL("https://аpple.com/").hostname)).toBe("xn--pple-43d.com");
    expect(displayHost(new URL("https://wiki.gg/").hostname)).toBe("wiki.gg");
  });
});
