import { describe, expect, it } from "vitest";
import type { AccountView, DeveloperKeysView } from "../shared/host-api";
import { AccountFlows } from "./account-flows";

const OLD = "0123456789abcdef0123456789abcdef";
const NEW = "fedcba9876543210fedcba9876543210";

interface Setup {
  /** The account signed in now; null when signed out. */
  signedIn?: string | null;
  /** Whether deleting with Discord took the account away (it may wait for a confirmation). */
  discordGone?: boolean;
  publisherKeys?: string[];
  pausedKeys?: string[];
  prefixes?: string[];
  prefix?: "free" | "taken";
  keys?: Pick<DeveloperKeysView, "status" | "keys">;
  pick?: string | undefined;
  online?: boolean;
}

function setup(options: Setup = {}) {
  const calls: string[] = [];
  const state = { signedIn: options.signedIn === undefined ? "account-1" : options.signedIn };
  const view = () =>
    ({
      account: state.signedIn ? { email: "nik@example.com" } : null,
      publisherKeys: (options.publisherKeys ?? []).map((fingerprint) => ({ fingerprint, linkedAt: "2026-11-01" })),
      pausedKeys: (options.pausedKeys ?? []).map((fingerprint) => ({ fingerprint })),
      prefixes: { held: options.prefixes ?? [], max: 3 },
    }) as unknown as AccountView;
  const flows = new AccountFlows({
    account: {
      view,
      accountId: () => state.signedIn,
      token: () => (state.signedIn ? "token" : null),
      signOut: async () => {
        calls.push("sign out");
        state.signedIn = null;
      },
      deleteAccount: async (code) => {
        calls.push(`delete ${code}`);
        state.signedIn = null;
      },
      deleteWithDiscord: async () => {
        calls.push("delete with Discord");
        if (options.discordGone !== false) state.signedIn = null;
      },
      setDeveloperName: async (name) => void calls.push(`name ${name}`),
      checkPrefix: async (prefix) => (calls.push(`check ${prefix}`), options.prefix ?? "free"),
      claimPrefix: async (prefix) => void calls.push(`claim ${prefix}`),
      replaceKey: async (old, next, leaked) => void calls.push(`replace ${old.slice(0, 4)} with ${next.slice(0, 4)}${leaked ? " leaked" : ""}`),
    },
    signInId: () => "saved-sign-in",
    inbox: { accountChanged: (signedIn) => void calls.push(`inbox ${signedIn}`) },
    developerKeys: {
      accountChanged: (account) => void calls.push(`keys for ${account}`),
      view: () => ({ hasKey: false, recoveryKey: null, ...(options.keys ?? { status: "none", keys: [] }) }) as DeveloperKeysView,
      create: async () => (calls.push("make key"), NEW),
      replacementFor: async (old, linked) => (calls.push(`replacement for ${old.slice(0, 4)} among ${linked.length}`), NEW),
    },
    copy: {
      accountChanged: (account) => void calls.push(`copy for ${account}`),
      signedOut: async (account) => void calls.push(`copy forgets ${account}`),
      turnOn: async (folder) => void calls.push(`copy on ${folder}`),
      move: async (folder) => void calls.push(`copy to ${folder}`),
    },
    dialogs: {
      pick: async (place) => (calls.push(`pick ${place}`), options.pick),
      remember: (place, picked) => void calls.push(`remember ${place} ${picked}`),
    },
    online: () => options.online ?? true,
  });
  return { flows, calls, view, state };
}

describe("AccountFlows", () => {
  it("tells the messages only when being signed in changes, and the keys and cloud copy which account it is each time", () => {
    const { flows, calls, view, state } = setup();
    flows.changed(view());
    flows.changed(view());
    state.signedIn = null;
    flows.changed(view());
    expect(calls).toEqual([
      "inbox true",
      "keys for saved-sign-in",
      "copy for saved-sign-in",
      "keys for saved-sign-in",
      "copy for saved-sign-in",
      "inbox false",
      "keys for null",
      "copy for null",
    ]);
  });

  it("has the cloud copy forget the key of the account that signed out or was deleted, read before it went", async () => {
    const out = setup();
    await out.flows.signOut();
    expect(out.calls).toEqual(["sign out", "copy forgets account-1"]);

    const deleted = setup();
    await deleted.flows.delete("123456");
    expect(deleted.calls).toEqual(["delete 123456", "copy forgets account-1"]);

    const discord = setup();
    await discord.flows.deleteWithDiscord();
    expect(discord.calls).toEqual(["delete with Discord", "copy forgets account-1"]);
    // Still there (Discord asks first): the cloud copy keeps its key.
    const waiting = setup({ discordGone: false });
    await waiting.flows.deleteWithDiscord();
    expect(waiting.calls).toEqual(["delete with Discord"]);
  });

  it("gives a first-time developer the prefix of their name when it is free, and a publisher key", async () => {
    const { flows, calls } = setup();
    await flows.setDeveloperName("WellBrained");
    expect(calls).toEqual(["name WellBrained", "check wellbrained", "claim wellbrained", "make key"]);

    const taken = setup({ prefix: "taken" });
    await taken.flows.setDeveloperName("WellBrained");
    expect(taken.calls).toEqual(["name WellBrained", "check wellbrained", "make key"]);
  });

  it("gives a developer with a prefix or a key, linked, kept or paused, nothing more", async () => {
    const prefixed = setup({ prefixes: ["wellbrained"], keys: { status: "ready", keys: [{ fingerprint: OLD }] } });
    await prefixed.flows.setDeveloperName("WellBrained");
    expect(prefixed.calls).toEqual(["name WellBrained"]);
    // A paused key is still the account's: it is linked again, never replaced by a new one.
    const paused = setup({ prefixes: ["wellbrained"], pausedKeys: [OLD] });
    await paused.flows.setDeveloperName("WellBrained");
    expect(paused.calls).toEqual(["name WellBrained"]);
    // Another PC keeps the account's key: its recovery key is asked for first.
    const asked = setup({ prefixes: ["wellbrained"], keys: { status: "ask", keys: [] } });
    await asked.flows.setDeveloperName("WellBrained");
    expect(asked.calls).toEqual(["name WellBrained"]);
  });

  it("replaces a linked or paused key of the account, and refuses one that isn't the account's", async () => {
    const linked = setup({ publisherKeys: [OLD, NEW] });
    await linked.flows.replaceKey(OLD, true);
    expect(linked.calls).toEqual(["replacement for 0123 among 2", "replace 0123 with fedc leaked"]);

    const paused = setup({ pausedKeys: [OLD] });
    await paused.flows.replaceKey(OLD, false);
    // Only linked keys can take its modules; a paused one isn't among them.
    expect(paused.calls).toEqual(["replacement for 0123 among 0", "replace 0123 with fedc"]);

    await expect(setup({ publisherKeys: [NEW] }).flows.replaceKey(OLD, false)).rejects.toMatchObject({ key: "account.error.keyGone" });
  });

  it("runs a messages action only while the online features are on and the user is signed in", async () => {
    expect(await setup().flows.messages(async () => "sent")).toBe("sent");
    await expect(setup({ online: false }).flows.messages(async () => "sent")).rejects.toMatchObject({ key: "error.catalogOff" });
    await expect(setup({ signedIn: null }).flows.messages(async () => "sent")).rejects.toMatchObject({ key: "account.error.signedOut" });
  });

  it("puts the cloud copy in a folder the user picks, remembered once it worked; nothing when the dialog is closed", async () => {
    const picked = setup({ pick: "D:/Sync/Tavora" });
    await picked.flows.turnOnInFolder();
    await picked.flows.moveCopy("folder");
    await picked.flows.moveCopy("server");
    expect(picked.calls).toEqual([
      "pick cloud-copy",
      "copy on D:/Sync/Tavora",
      "remember cloud-copy D:/Sync/Tavora",
      "pick cloud-copy",
      "copy to D:/Sync/Tavora",
      "remember cloud-copy D:/Sync/Tavora",
      "copy to null",
    ]);

    const closed = setup({ pick: undefined });
    await closed.flows.turnOnInFolder();
    await closed.flows.moveCopy("folder");
    expect(closed.calls).toEqual(["pick cloud-copy", "pick cloud-copy"]);
  });
});
