import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { encodeFrame, FrameReader, ipcPaths, isOwnSocket, MAX_FRAME, RpcClient, RpcError, type SocketSystem } from "./discord-rpc";
import { fakeDiscord, until, type FakeDiscord } from "./discord-fake.test-helper";

let fake: FakeDiscord | undefined;
afterEach(async () => {
  await fake?.close();
  fake = undefined;
});

describe("Discord frames", () => {
  it("reads frames split across chunks and several in one chunk", () => {
    const reader = new FrameReader();
    const bytes = Buffer.concat([encodeFrame(1, { a: 1 }), encodeFrame(3, { b: 2 })]);
    expect(reader.push(bytes.subarray(0, 5))).toEqual([]);
    expect(reader.push(bytes.subarray(5))).toEqual([
      { op: 1, data: { a: 1 } },
      { op: 3, data: { b: 2 } },
    ]);
  });

  it("refuses frames that are too large", () => {
    const head = Buffer.alloc(8);
    head.writeInt32LE(1, 0);
    head.writeInt32LE(MAX_FRAME + 1, 4);
    expect(() => new FrameReader().push(head)).toThrow();
  });

  it("knows where Discord listens", () => {
    expect(ipcPaths("win32", {})[0]).toBe("\\\\?\\pipe\\discord-ipc-0");
    expect(ipcPaths("win32", {})).toHaveLength(10);
    const linux = ipcPaths("linux", { XDG_RUNTIME_DIR: "/run/user/1000" });
    expect(linux).toContain(path.join("/run/user/1000", "discord-ipc-0"));
    expect(linux).toContain(path.join("/run/user/1000", "app", "com.discordapp.Discord", "discord-ipc-3"));
    expect(linux).toContain(path.join("/run/user/1000", "snap.discord", "discord-ipc-9"));
  });
});

describe("isOwnSocket", () => {
  /** A pretend file system: owners by path; links are where stat and lstat disagree. */
  const system = (platform: NodeJS.Platform, uid: number | undefined, owners: Record<string, number>, links: Record<string, number> = {}): SocketSystem => {
    const owner = async (file: string) => {
      if (!(file in owners)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return { uid: owners[file]! };
    };
    return { platform, uid, stat: owner, lstat: async (file) => (file in links ? { uid: links[file]! } : owner(file)) };
  };
  const folders = { "/": 0, "/tmp": 0, "/run": 0, "/run/user": 0, "/run/user/1000": 1000 };

  it("takes a socket only when this user owns it, on Linux and macOS", async () => {
    for (const platform of ["linux", "darwin"] as const) {
      const owners = { ...folders, "/tmp/discord-ipc-0": 1000, "/tmp/discord-ipc-1": 1001, "/tmp/discord-ipc-2": 0, "/run/user/1000/discord-ipc-0": 1000 };
      expect(await isOwnSocket("/tmp/discord-ipc-0", system(platform, 1000, owners))).toBe(true);
      expect(await isOwnSocket("/run/user/1000/discord-ipc-0", system(platform, 1000, owners))).toBe(true);
      // Another account, root too, could have made it first to catch the token.
      expect(await isOwnSocket("/tmp/discord-ipc-1", system(platform, 1000, owners))).toBe(false);
      expect(await isOwnSocket("/tmp/discord-ipc-2", system(platform, 1000, owners))).toBe(false);
      expect(await isOwnSocket("/tmp/discord-ipc-9", system(platform, 1000, owners))).toBe(false);
      // Without a user id there's nothing to compare.
      expect(await isOwnSocket("/tmp/discord-ipc-0", system(platform, undefined, owners))).toBe(false);
    }
  });

  it("refuses a socket in a folder another account owns, which could swap it after the check", async () => {
    const where = "/tmp/app/com.discordapp.Discord/discord-ipc-0";
    const owners = { ...folders, "/tmp/app": 1001, "/tmp/app/com.discordapp.Discord": 1000, [where]: 1000 };
    expect(await isOwnSocket(where, system("linux", 1000, owners))).toBe(false);
    expect(await isOwnSocket(where, system("linux", 1000, { ...owners, "/tmp/app": 1000 }))).toBe(true);
    // A folder that is a link made by another account counts as theirs, wherever it leads.
    expect(await isOwnSocket(where, system("linux", 1000, { ...owners, "/tmp/app": 1000 }, { "/tmp/app/com.discordapp.Discord": 1001 }))).toBe(false);
  });

  it("doesn't check pipes on Windows", async () => {
    expect(await isOwnSocket(ipcPaths("win32", {})[0]!, system("win32", undefined, {}))).toBe(true);
  });
});

describe("RpcClient", () => {
  it("skips a socket another account owns, and says nothing to it", async () => {
    fake = await fakeDiscord();
    const checked: string[] = [];
    const theirs: SocketSystem = {
      platform: "linux",
      uid: 1000,
      stat: async (file) => {
        checked.push(file);
        return { uid: 1001 };
      },
      lstat: async () => ({ uid: 0 }),
    };
    const client = await RpcClient.connect("42", { onEvent: () => undefined, onClose: () => undefined }, [fake.path], theirs);
    expect(client).toBeNull();
    expect(checked).toEqual([fake.path]);
    expect(fake.clientId).toBeNull();
  });

  it("returns null when no Discord app is running", async () => {
    const client = await RpcClient.connect("1", { onEvent: () => undefined, onClose: () => undefined }, ["/nonexistent/discord-ipc-0"]);
    expect(client).toBeNull();
  });

  it("says hello with the client id, answers commands and passes events on", async () => {
    fake = await fakeDiscord();
    fake.answers.set("GET_SELECTED_VOICE_CHANNEL", () => ({ data: { id: "10" } }));
    fake.answers.set("AUTHENTICATE", () => ({ error: { code: 4009, message: "Invalid token" } }));
    const events: string[] = [];
    let closed = "";
    const client = (await RpcClient.connect("42", { onEvent: (evt) => events.push(evt), onClose: (reason) => (closed = reason) }, [fake.path]))!;
    expect(fake.clientId).toBe("42");
    expect(await client.command("GET_SELECTED_VOICE_CHANNEL")).toEqual({ id: "10" });
    await expect(client.command("AUTHENTICATE", { access_token: "x" })).rejects.toEqual(new RpcError(4009, "Invalid token"));
    fake.dispatch("SPEAKING_START", { user_id: "1" });
    await until(() => events.length === 1);
    expect(events).toEqual(["SPEAKING_START"]);
    fake.drop();
    await until(() => closed !== "");
    expect(client.isClosed).toBe(true);
    await expect(client.command("GET_SELECTED_VOICE_CHANNEL")).rejects.toBeInstanceOf(RpcError);
  });
});
