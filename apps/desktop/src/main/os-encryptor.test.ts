import { beforeEach, describe, expect, it, vi } from "vitest";

// Stands in for Electron's safeStorage: the bytes are the format the sync calls wrote ("v10" + a scrambled copy), so
// what an older Tavora saved is read here by the async calls.
const scramble = (text: string) => Buffer.concat([Buffer.from("v10"), Buffer.from([...Buffer.from(text)].map((byte) => byte ^ 0x5a))]);
const fake = vi.hoisted(() => ({
  available: true,
  backend: "gnome_libsecret",
  reEncrypt: 0,
  setUsePlainTextEncryption: vi.fn(),
  isAsyncEncryptionAvailable: () => (fake.hang ? new Promise<boolean>(() => undefined) : Promise.resolve(fake.available)),
  getSelectedStorageBackend: () => fake.backend,
  hang: false,
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
  fake.isAsyncEncryptionAvailable = () => (fake.hang ? new Promise<boolean>(() => undefined) : Promise.resolve(fake.available));
  fake.available = true;
  fake.backend = "gnome_libsecret";
  fake.reEncrypt = 0;
  fake.hang = false;
});

describe("the system key store, async", () => {
  it("opens what the sync calls sealed before", async () => {
    const old = scramble(JSON.stringify({ token: "abc" }));
    expect(await osEncryptor(false).decrypt(old)).toBe('{"token":"abc"}');
  });

  it("writes the same bytes the sync calls wrote", async () => {
    expect((await osEncryptor(false).encrypt("hello")).equals(scramble("hello"))).toBe(true);
  });

  it("reads again when the key has moved, and says the data should be sealed again", async () => {
    fake.reEncrypt = 1;
    const note = { stale: false };
    expect(await osEncryptor(false).decrypt(scramble("hi"), note)).toBe("hi");
    expect(note.stale).toBe(true);
  });

  it("asks again after a no, so a keyring unlocked later is found", async () => {
    const encryptor = osEncryptor(false);
    fake.available = false;
    expect(await encryptor.ready()).toBe(false);
    fake.available = true;
    expect(await encryptor.ready()).toBe(true);
  });

  it("counts a key store that doesn't answer as not available, for that call", async () => {
    fake.hang = true;
    const encryptor = osEncryptor(false, 20);
    expect(await encryptor.ready()).toBe(false);
    expect(encryptor.isAvailable()).toBe(false);
  });

  it("while a timed-out check is still pending, later calls say no at once, and the late answer is told", async () => {
    fake.hang = true;
    let answer!: (value: boolean) => void;
    fake.isAsyncEncryptionAvailable = () => new Promise<boolean>((resolve) => (answer = resolve));
    const told = vi.fn();
    const encryptor = osEncryptor(false, 20, told);
    expect(await encryptor.ready()).toBe(false);
    const started = Date.now();
    expect(await encryptor.ready()).toBe(false);
    expect(await encryptor.ready()).toBe(false);
    expect(Date.now() - started).toBeLessThan(15);
    expect(told).not.toHaveBeenCalled();
    answer(true);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(encryptor.isAvailable()).toBe(true);
    expect(told).toHaveBeenCalledTimes(1);
    expect(await encryptor.ready()).toBe(true);
  });

  it("tells when a quick no turns into a yes on a later ask, once", async () => {
    const told = vi.fn();
    const encryptor = osEncryptor(false, 1000, told);
    fake.available = true;
    expect(await encryptor.ready()).toBe(true);
    expect(told).not.toHaveBeenCalled();

    const later = osEncryptor(false, 1000, told);
    fake.available = false;
    expect(await later.ready()).toBe(false);
    fake.available = true;
    expect(await later.ready(true)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(told).toHaveBeenCalledTimes(1);
    expect(await later.ready()).toBe(true);
    expect(told).toHaveBeenCalledTimes(1);
  });

  it("a check that never answers is asked again when the user acts, or after a long while", async () => {
    fake.isAsyncEncryptionAvailable = () => new Promise<boolean>(() => undefined);
    const encryptor = osEncryptor(false, 10, undefined, 60);
    expect(await encryptor.ready()).toBe(false);
    // The keyring is unlocked since: the user acting (Turn on) asks again.
    fake.isAsyncEncryptionAvailable = () => Promise.resolve(true);
    expect(await encryptor.ready()).toBe(false);
    expect(await encryptor.ready(true)).toBe(true);
    // The same after the long wait, without the user acting.
    const patient = osEncryptor(false, 10, undefined, 40);
    fake.isAsyncEncryptionAvailable = () => new Promise<boolean>(() => undefined);
    expect(await patient.ready()).toBe(false);
    fake.isAsyncEncryptionAvailable = () => Promise.resolve(true);
    expect(await patient.ready()).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await patient.ready()).toBe(true);
  });

  it("an older question that answers no after a newer one said yes leaves it yes", async () => {
    let first: (answer: boolean) => void = () => undefined;
    fake.isAsyncEncryptionAvailable = () => new Promise<boolean>((resolve) => (first = resolve));
    const encryptor = osEncryptor(false, 10);
    expect(await encryptor.ready()).toBe(false);
    const stale = first;
    fake.isAsyncEncryptionAvailable = () => Promise.resolve(true);
    expect(await encryptor.ready(true)).toBe(true);
    stale(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(encryptor.isAvailable()).toBe(true);
    expect(await encryptor.ready()).toBe(true);
  });

  it("asks no more while two questions are still open, so keyring prompts don't stack", async () => {
    let asked = 0;
    fake.isAsyncEncryptionAvailable = () => {
      asked++;
      return new Promise<boolean>(() => undefined);
    };
    const encryptor = osEncryptor(false, 10);
    expect(await encryptor.ready()).toBe(false);
    for (let i = 0; i < 4; i++) expect(await encryptor.ready(true)).toBe(false);
    expect(asked).toBe(2);
  });

  it("is not available before it is asked, and is the answer of the last ask after", async () => {
    const encryptor = osEncryptor(false);
    expect(encryptor.isAvailable()).toBe(false);
    expect(await encryptor.ready()).toBe(true);
    expect(encryptor.isAvailable()).toBe(true);
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
