import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { AccountStore } from "./account-store.ts";
import { optionalSignIn, requireSignIn, tooMany, type MaybeSignedInEnv, type SignedInEnv } from "./sign-in.ts";
import { createUploadMemory } from "./upload-memory.ts";

const NOW = Date.parse("2026-10-29T12:00:00Z");

function setup() {
  const store = new AccountStore(":memory:");
  const account = store.createAccount({ email: "mara@example.com" }, NOW);
  const { token } = store.createSession(account.id, "windows", NOW);
  const required = new Hono<SignedInEnv>().use("*", requireSignIn(store, () => NOW)).get("/", (context) => context.json({ id: context.get("account").id }));
  const optional = new Hono<MaybeSignedInEnv>().use("*", optionalSignIn(store, () => NOW)).get("/", (context) => context.json({ id: context.get("account")?.id ?? null }));
  const ask = (app: Hono<never>, authorization?: string) => app.request("http://tavora.test/", authorization === undefined ? {} : { headers: { authorization } });
  return { store, account, token, required: required as unknown as Hono<never>, optional: optional as unknown as Hono<never>, ask };
}

describe("the sign-in gate", () => {
  it("checks the sign-in again once the body is in, so one that ended while it came in lets nothing through (audit 2026-11-22)", async () => {
    const store = new AccountStore(":memory:");
    const account = store.createAccount({ email: "mara@example.com" }, NOW);
    const { token, session } = store.createSession(account.id, "windows", NOW);
    let reached = false;
    // A route with no check of its own: only the gate stands between the body and the write.
    const app = new Hono<SignedInEnv>().use("*", requireSignIn(store, () => NOW)).post("/", async (context) => {
      reached = true;
      return context.json({ body: await context.req.text() });
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        await gate;
        controller.enqueue(new TextEncoder().encode("late"));
        controller.close();
      },
    });
    const answer = app.request("http://tavora.test/", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-length": "4" }, body, duplex: "half" } as RequestInit);
    await new Promise((resolve) => setTimeout(resolve, 20));
    store.deleteSession(account.id, session.id);
    release();
    expect((await answer).status).toBe(401);
    expect(reached).toBe(false);
  });


  it("lets a signed-in account through, keeps its answers out of caches, and refuses everything else the same way", async () => {
    const { account, token, required, ask } = setup();
    const ok = await ask(required, `Bearer ${token}`);
    expect(await ok.json()).toEqual({ id: account.id });
    expect(ok.headers.get("cache-control")).toBe("no-store");
    for (const header of [undefined, "", `Bearer ${"x".repeat(43)}`, `Basic ${token}`, `Bearer ${token} extra`]) {
      const refused = await ask(required, header);
      expect(refused.status).toBe(401);
      expect(await refused.json()).toEqual({ error: "Sign in again.", reason: "signed-out" });
    }
  });

  it("signs out a suspended account", async () => {
    const { store, account, token, required, ask } = setup();
    store.suspend(account.id, "spam", null, NOW);
    expect((await ask(required, `Bearer ${token}`)).status).toBe(401);
  });

  it("lets a guest in without a header, but not with a token that doesn't work", async () => {
    const { account, token, optional, ask } = setup();
    expect(await (await ask(optional)).json()).toEqual({ id: null });
    expect(await (await ask(optional, `Bearer ${token}`)).json()).toEqual({ id: account.id });
    expect((await ask(optional, `Bearer ${"x".repeat(43)}`)).status).toBe(401);
  });

  it("holds big bodies in a shared budget and a few at a time per account, so slow uploads can't fill the service's memory (audit run 7)", async () => {
    const store = new AccountStore(":memory:");
    const mara = store.createAccount({ email: "mara@example.com" }, NOW);
    const juno = store.createAccount({ email: "juno@example.com" }, NOW);
    const maraToken = store.createSession(mara.id, "windows", NOW).token;
    const junoToken = store.createSession(juno.id, "windows", NOW).token;
    // A body is held twice while it is read and handed on, so 40 bytes count as 80.
    const memory = createUploadMemory(200);
    const app = new Hono<SignedInEnv>()
      .use("*", requireSignIn(store, () => NOW, 64, { memory, perAccount: 1 }))
      .post("/", async (context) => context.json({ length: (await context.req.arrayBuffer()).byteLength }));
    const releases: (() => void)[] = [];
    const stalled = (length: number) => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      releases.push(release);
      return new ReadableStream<Uint8Array>({
        async start(controller) {
          await gate;
          controller.enqueue(new Uint8Array(length));
          controller.close();
        },
      });
    };
    const post = (token: string, length: number, body: ReadableStream<Uint8Array> | Uint8Array = stalled(length)) =>
      app.request("http://tavora.test/", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-length": String(length) }, body, duplex: "half" } as RequestInit);

    const first = post(maraToken, 40);
    await new Promise((resolve) => setTimeout(resolve, 20));
    // Mara's second body waits for her first.
    const second = await post(maraToken, 1, new Uint8Array(1));
    expect(second.status).toBe(503);
    expect(second.headers.get("retry-after")).toBe("30");
    expect(await second.json()).toEqual({ error: "Tavora is busy right now. Try again in a minute.", reason: "unavailable" });
    // Juno's doesn't fit next to it: 80 + 128 is more than 200.
    expect((await post(junoToken, 64, new Uint8Array(64))).status).toBe(503);
    // A smaller one does.
    expect(await (await post(junoToken, 40, new Uint8Array(40))).json()).toEqual({ length: 40 });

    releases[0]!();
    expect(await (await first).json()).toEqual({ length: 40 });
    // Everything is handed back once the answers are out.
    expect(memory.take(200)).not.toBeNull();
  });

  it("hands back a body's memory when the route fails or the body is too big", async () => {
    const store = new AccountStore(":memory:");
    const account = store.createAccount({ email: "mara@example.com" }, NOW);
    const { token } = store.createSession(account.id, "windows", NOW);
    const memory = createUploadMemory(200);
    const app = new Hono<SignedInEnv>().use("*", requireSignIn(store, () => NOW, 64, { memory, perAccount: 1 })).post("/", () => {
      throw new Error("broken");
    });
    app.onError((_error, context) => context.text("broken", 500));
    const post = (body: Uint8Array, length = body.length) =>
      app.request("http://tavora.test/", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-length": String(length) }, body });
    expect((await post(new Uint8Array(10))).status).toBe(500);
    expect((await post(new Uint8Array(65))).status).toBe(413);
    // A body longer than its length said is read only as far as the room it took.
    const longer = new ReadableStream<Uint8Array>({ start: (controller) => (controller.enqueue(new Uint8Array(40)), controller.close()) });
    const lied = await app.request("http://tavora.test/", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-length": "10" }, body: longer, duplex: "half" } as RequestInit);
    expect(lied.status).toBe(413);
    expect(memory.take(200)).not.toBeNull();
  });

  it("refuses a declared length past the limit before booking any memory, even when there is none left", async () => {
    const store = new AccountStore(":memory:");
    const account = store.createAccount({ email: "mara@example.com" }, NOW);
    const { token } = store.createSession(account.id, "windows", NOW);
    const memory = createUploadMemory(200);
    const all = memory.take(200)!;
    const app = new Hono<SignedInEnv>().use("*", requireSignIn(store, () => NOW, 64, { memory, perAccount: 1 })).post("/", (context) => context.text("ok"));
    const answer = await app.request("http://tavora.test/", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-length": "65" }, body: new Uint8Array(65) });
    expect(answer.status).toBe(413);
    all.release();
    expect(memory.take(200)).not.toBeNull();
  });

  it("books no room and no slot for a request without a body, as turning off the cloud copy sends (hunt 2026-11-25 E2)", async () => {
    const store = new AccountStore(":memory:");
    const account = store.createAccount({ email: "mara@example.com" }, NOW);
    const { token } = store.createSession(account.id, "windows", NOW);
    const memory = createUploadMemory(200);
    const app = new Hono<SignedInEnv>()
      .use("*", requireSignIn(store, () => NOW, 64, { memory, perAccount: 1 }))
      .delete("/", (context) => context.text("gone"))
      .post("/", async (context) => context.text(String((await context.req.arrayBuffer()).byteLength)));
    // Every byte of room is taken and the account's one slot is busy with a body that hasn't come in yet.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const stalled = new ReadableStream<Uint8Array>({ start: async (controller) => (await gate, controller.enqueue(new Uint8Array(10)), controller.close()) });
    const upload = app.request("http://tavora.test/", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-length": "10" }, body: stalled, duplex: "half" } as RequestInit);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const rest = memory.take(180)!;
    // Node gives a DELETE an empty stream although it says no length and isn't chunked.
    const empty = new ReadableStream<Uint8Array>({ start: (controller) => controller.close() });
    const removed = await app.request("http://tavora.test/", { method: "DELETE", headers: { authorization: `Bearer ${token}` }, body: empty, duplex: "half" } as RequestInit);
    expect(removed.status).toBe(200);
    expect(await removed.text()).toBe("gone");
    // An empty POST too.
    const nothing = await app.request("http://tavora.test/", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-length": "0" }, body: new Uint8Array(0) });
    expect(await nothing.text()).toBe("0");
    // A chunked body says nothing about its size: it still needs room.
    const chunked = new ReadableStream<Uint8Array>({ start: (controller) => (controller.enqueue(new Uint8Array(1)), controller.close()) });
    expect((await app.request("http://tavora.test/", { method: "POST", headers: { authorization: `Bearer ${token}`, "transfer-encoding": "chunked" }, body: chunked, duplex: "half" } as RequestInit)).status).toBe(503);
    release();
    expect(await (await upload).text()).toBe("10");
    rest.release();
    expect(memory.take(200)).not.toBeNull();
  });

  it("cuts off a body that stops coming, or comes too slowly, and hands its memory back", async () => {
    const store = new AccountStore(":memory:");
    const account = store.createAccount({ email: "mara@example.com" }, NOW);
    const { token } = store.createSession(account.id, "windows", NOW);
    const memory = createUploadMemory(200);
    const app = new Hono<SignedInEnv>()
      .use("*", requireSignIn(store, () => NOW, 64, { memory, perAccount: 1 }, { idleMs: 50, graceMs: 100, bytesPerSecond: 1000 }))
      .post("/", (context) => context.text("ok"));
    const post = (body: ReadableStream<Uint8Array>) =>
      app.request("http://tavora.test/", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-length": "40" }, body, duplex: "half" } as RequestInit);
    // One byte, then nothing.
    const stopped = await post(new ReadableStream({ start: (controller) => void controller.enqueue(new Uint8Array(1)) }));
    expect(stopped.status).toBe(408);
    expect(((await stopped.json()) as { reason: string }).reason).toBe("invalid");
    // A byte every 40 ms: never idle for 50 ms, but far behind 1000 bytes a second once the grace is over.
    let sent = 0;
    const trickle = new ReadableStream<Uint8Array>({
      async pull(controller) {
        await new Promise((resolve) => setTimeout(resolve, 40));
        if (++sent > 40) controller.close();
        else controller.enqueue(new Uint8Array(1));
      },
    });
    expect((await post(trickle)).status).toBe(408);
    expect(memory.take(200)).not.toBeNull();
  });

  it("says how long to wait when there were too many requests", async () => {
    const app = new Hono().get("/", (context) => tooMany(context, 30));
    const answer = await app.request("http://tavora.test/");
    expect(answer.status).toBe(429);
    expect(answer.headers.get("retry-after")).toBe("30");
    expect(await answer.json()).toEqual({ error: "Too many requests. Try again later.", reason: "too-many" });
  });
});
