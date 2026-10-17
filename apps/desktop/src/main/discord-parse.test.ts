import { describe, expect, it } from "vitest";
import { cleanName, imageUrl, parseScopes, parseUser, pngDataUrl } from "./discord-parse";

const HASH = "0123456789abcdef0123456789abcdef";

describe("Discord data the connector reads", () => {
  it("cleans names: no control or direction characters, at most 64 characters", () => {
    expect(cleanName("‮evil\u0007 ", "x")).toBe("evil");
    expect(cleanName("", "fallback")).toBe("fallback");
    expect(cleanName(42, "fallback")).toBe("fallback");
    expect([...cleanName("é".repeat(100), "x")]).toHaveLength(64);
  });

  it("only accepts Discord's own avatar and icon addresses, always as a small PNG", () => {
    expect(imageUrl(`https://cdn.discordapp.com/icons/20/${HASH}.webp?size=1024`)).toBe(`https://cdn.discordapp.com/icons/20/${HASH}.png?size=64`);
    expect(imageUrl(`https://cdn.discordapp.com/avatars/1/a_${HASH}.gif`)).toBe(`https://cdn.discordapp.com/avatars/1/a_${HASH}.png?size=64`);
    expect(imageUrl(`https://evil.example/icons/20/${HASH}.png`)).toBeNull();
    expect(imageUrl(`https://cdn.discordapp.com.evil.example/icons/20/${HASH}.png`)).toBeNull();
    expect(imageUrl(`https://user:pw@cdn.discordapp.com/icons/20/${HASH}.png`)).toBeNull();
    expect(imageUrl(`http://cdn.discordapp.com/icons/20/${HASH}.png`)).toBeNull();
    expect(imageUrl(`https://cdn.discordapp.com/attachments/1/2/x.png`)).toBeNull();
    expect(imageUrl(`https://cdn.discordapp.com/avatars/1/nope.png`)).toBeNull();
    expect(imageUrl("javascript:alert(1)")).toBeNull();
    expect(imageUrl(7)).toBeNull();
  });

  it("keeps only small PNGs as pictures", () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(10)]);
    expect(pngDataUrl(png)).toMatch(/^data:image\/png;base64,/);
    expect(pngDataUrl(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
    expect(pngDataUrl(Buffer.concat([png, Buffer.alloc(300 * 1024)]))).toBeNull();
  });

  it("reads the signed-in user and the scopes of a sign-in", () => {
    expect(parseUser({ user: { id: "7", username: "robin", global_name: "Robin" } })).toEqual({ id: "7", name: "Robin" });
    expect(parseUser({})).toBeNull();
    expect(parseScopes({ scopes: ["rpc", 7, "identify"] })).toEqual(["rpc", "identify"]);
    expect(parseScopes(null)).toEqual([]);
  });
});
