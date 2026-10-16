import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { AccountStore } from "./account-store.ts";

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
    insert into profiles values ('acc1', 'wellbrained', 'NK', null, 1760000000000);
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
    expect(store.profile("acc1")).toMatchObject({ name: "wellbrained", initials: "NK" });
    // The email is optional now, and the links to sign-ins and profiles still hold.
    expect(store.createAccount({ discord: { id: "123456789012345678", name: "nik" } }, 1760000000002).email).toBeNull();
    store.deleteAccount("acc1");
    expect(store.devices("acc1")).toEqual([]);
    expect(store.profile("acc1")).toBeNull();
    store.close();

    // Opening it again changes nothing.
    const again = new AccountStore(file);
    expect(again.accountByEmail("you@example.com")?.id).toBe("acc2");
    expect(again.accountByDiscord("123456789012345678")?.discord).toEqual({ id: "123456789012345678", name: "nik" });
    again.close();
  });

  it("still refuses an account with no way to sign in", () => {
    const store = new AccountStore(":memory:");
    expect(() => store.createAccount({}, 0)).toThrow();
    const db = (store as unknown as { db: DatabaseSync }).db;
    expect(() => db.prepare("insert into accounts (id, created_at) values ('x', 0)").run()).toThrow(/CHECK/);
    store.close();
  });
});
