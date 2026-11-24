import { beforeEach, describe, expect, it, vi } from "vitest";

// Stands in for Electron's safeStorage: the bytes are the format the sync calls wrote ("v10" + a scrambled copy), so
// what an older Tavora saved is read here by the async calls.
const scramble = (text: string) => Buffer.concat([Buffer.from("v10"), Buffer.from([...Buffer.from(text)].map((byte) => byte ^ 0x5a))]);
const fake = vi.hoisted(() => ({
  available: true,
  backend: "gnome_libsecret",
  reEncrypt: 0,
  setUsePlainTextEncryption: vi.fn(),
  isAsyncEncryptionAvailable: async () => fake.available,
  getSelectedStorageBackend: () => fake.backend,
  encryptStringAsync: async (text: string) => Buffer.concat([Buffer.from("v10"), Buffer.from([...Buffer.from(text)].map((byte) => byte ^ 0x5a))]),
  decryptStringAsync: async (data: Buffer) => {
    if (data.subarray(0, 3).toString() !== "v10") throw new Error("not ours");
    const result = Buffer.from([...data.subarray(3)].map((byte) => byte ^ 0x5a)).toString();
    // The first read says the key has moved; the second gives the text.
    if (fake.reEncrypt > 0) {
      fake.reEncrypt -= 1;
      return { shouldReEncrypt: true, result: "stale" };
    }
    return { shouldReEncrypt: false, result };
  },
}));
vi.mock("electron", () => ({ safeStorage: fake }));

const { osEncryptor } = await import("./os-encryptor");

beforeEach(() => {
  fake.available = true;
  fake.backend = "gnome_libsecret";
  fake.reEncrypt = 0;
});

describe("the system key store, async", () => {
  it("opens what the sync calls sealed before", async () => {
    const old = scramble(JSON.stringify({ token: "abc" }));
    expect(await osEncryptor(false).decrypt(old)).toBe('{"token":"abc"}');
  });

  it("writes the same bytes the sync calls wrote", async () => {
    expect((await osEncryptor(false).encrypt("hello")).equals(scramble("hello"))).toBe(true);
  });

  it("reads again when the key has moved", async () => {
    fake.reEncrypt = 1;
    expect(await osEncryptor(false).decrypt(scramble("hi"))).toBe("hi");
  });

  it("is not available before it is asked, and follows the system after", async () => {
    const encryptor = osEncryptor(false);
    expect(encryptor.isAvailable()).toBe(false);
    expect(await encryptor.ready()).toBe(true);
    expect(encryptor.isAvailable()).toBe(true);
    fake.available = false;
    expect(await encryptor.ready()).toBe(false);
    expect(encryptor.isAvailable()).toBe(false);
  });

  it("two checks at once give the same answer", async () => {
    const encryptor = osEncryptor(false);
    expect(await Promise.all([encryptor.ready(), encryptor.ready()])).toEqual([true, true]);
  });

  it.runIf(process.platform === "linux")("treats Linux's plain-text fallback as unavailable, except in a test run", async () => {
    fake.backend = "basic_text";
    expect(await osEncryptor(false).ready()).toBe(false);
    expect(await osEncryptor(true).ready()).toBe(true);
  });
});
