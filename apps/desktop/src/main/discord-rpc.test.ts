import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { encodeFrame, FrameReader, ipcPaths, MAX_FRAME, RpcClient, RpcError } from "./discord-rpc";
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

describe("RpcClient", () => {
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
