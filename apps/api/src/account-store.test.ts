import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { AccountStore, KNOWN_NETWORK_MS } from "./account-store.ts";

/** The accounts file as it was before Discord logins (0.16.x): every account had to have an email. */
function oldDatabase(): string {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), "tavora-accounts-")), "accounts.sqlite");
  const db = new DatabaseSync(file);
  db.exec(`
    pragma foreign_keys = on;
    create table accounts (id text primary key, email text not null unique, created_at integer not null);
    create table sessions (
      id text primary key, token_hash text not null unique,
      account_id text not null references accounts (id) on delete cascade,
      os text not null, created_at integer not null, last_used_at integer not null
    );
    create table profiles (
      account_id text primary key references accounts (id) on delete cascade,
      name text not null, initials text not null, picture blob, updated_at integer not null
    );
    insert into accounts values ('acc1', 'me@example.com', 1760000000000), ('acc2', 'you@example.com', 1760000000001);
    insert into sessions values ('s1', 'hash1', 'acc1', 'windows', 1760000000000, 1760000000000);
    insert into profiles values ('acc1', 'Alex', 'AX', null, 1760000000000);
  `);
  db.close();
  return file;
}

describe("the accounts file from before Discord logins", () => {
  it("is rebuilt once with every account, sign-in and profile kept", () => {
    const file = oldDatabase();
    const store = new AccountStore(file);
    expect(store.accountByEmail("me@example.com")).toEqual({ id: "acc1", email: "me@example.com", discord: null, createdAt: new Date(1760000000000).toISOString() });
    expect(store.accountByEmail("you@example.com")?.id).toBe("acc2");
    expect(store.devices("acc1")).toHaveLength(1);
    expect(store.profile("acc1")).toMatchObject({ name: "Alex", initials: "AX" });
    // The email is optional now, and the links to sign-ins and profiles still hold.
    expect(store.createAccount({ discord: { id: "123456789012345678", name: "alex" } }, 1760000000002).email).toBeNull();
    store.deleteAccount("acc1");
    expect(store.devices("acc1")).toEqual([]);
    expect(store.profile("acc1")).toBeNull();
    store.close();

    // Opening it again changes nothing.
    const again = new AccountStore(file);
    expect(again.accountByEmail("you@example.com")?.id).toBe("acc2");
    expect(again.accountByDiscord("123456789012345678")?.discord).toEqual({ id: "123456789012345678", name: "alex" });
    again.close();
  });

  it("counts code requests from before owners were told apart as anyone's", () => {
    const file = oldDatabase();
    const db = new DatabaseSync(file);
    const now = 1760000000000;
    // 20 requests for one address in the last hour, as an older service wrote them (by the hash of the address).
    const address = createHash("sha256").update("address:me@example.com").digest("hex");
    db.exec("create table code_requests (address text not null, at integer not null)");
    for (let i = 0; i < 20; i++) db.prepare("insert into code_requests (address, at) values (?, ?)").run(address, now - 60 * 60_000 + i);
    db.close();
    const store = new AccountStore(file);
    expect(store.codeWait("me@example.com", now, { from: "another" })).toBeGreaterThan(0);
    expect(store.codeWait("me@example.com", now, { owner: true })).toBe(0);
    expect(store.requestCode("me@example.com", "delete", "acc1", now, { owner: true }).ok).toBe(true);
    store.close();
  });

  it("remembers a network an address signed in from for 30 days, as a hash, across restarts", () => {
    const file = oldDatabase();
    const now = 1760000000000;
    const store = new AccountStore(file);
    store.rememberNetwork("me@example.com", "192.0.2.0/24", now);
    // Strangers use up their 10 a day.
    for (let i = 0; i < 10; i++) expect(store.countCodeRequest("me@example.com", now + i, { from: `net${i}` })).toBe(0);
    store.close();
    const reopened = new AccountStore(file);
    expect(reopened.codeWait("me@example.com", now + 20, { from: "elsewhere" })).toBeGreaterThan(0);
    expect(reopened.codeWait("me@example.com", now + 20, { from: "192.0.2.0/24" })).toBe(0);
    const db = (reopened as unknown as { db: DatabaseSync }).db;
    expect(JSON.stringify(db.prepare("select * from known_networks").all())).not.toMatch(/192\.0\.2|example/);
    // After 30 days it is a stranger's network again (and the day's requests are long gone).
    expect(reopened.codeWait("me@example.com", now + KNOWN_NETWORK_MS + 1, { from: "192.0.2.0/24" })).toBe(0);
    for (let i = 0; i < 10; i++) reopened.countCodeRequest("me@example.com", now + KNOWN_NETWORK_MS + 2 + i, { from: `later${i}` });
    expect(reopened.codeWait("me@example.com", now + KNOWN_NETWORK_MS + 20, { from: "192.0.2.0/24" })).toBeGreaterThan(0);
    reopened.close();
  });

  it("still refuses an account with no way to sign in", () => {
    const store = new AccountStore(":memory:");
    expect(() => store.createAccount({}, 0)).toThrow();
    const db = (store as unknown as { db: DatabaseSync }).db;
    expect(() => db.prepare("insert into accounts (id, created_at) values ('x', 0)").run()).toThrow(/CHECK/);
    store.close();
  });
});
