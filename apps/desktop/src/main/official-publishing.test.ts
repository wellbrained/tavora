import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fingerprint } from "@tavora/pack";
import { describe, expect, it, vi } from "vitest";
import type { OfficialPublishOverview, OfficialPublishRun } from "../shared/host-api";
import { UserError } from "./messages";
import { PublishCancelled } from "./official-publish";
import { OfficialPublishing, type OfficialPublisherPort, type OfficialPublishingOptions } from "./official-publishing";

const newKey = () => generateKeyPairSync("ed25519").privateKey;

/** A key file on disk, as a developer would pick it. */
async function keyFile(key: KeyObject): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "tavora-official-"));
  const file = path.join(dir, "tavora.pem");
  await writeFile(file, key.export({ format: "pem", type: "pkcs8" }) as string);
  return file;
}

/** A publisher that answers at once, with what each call got. */
function fakePublisher(overview: OfficialPublishOverview = { rows: [] } as unknown as OfficialPublishOverview) {
  let run: OfficialPublishRun = { phase: "idle" };
  const keys: (KeyObject | null)[] = [];
  const publisher = {
    view: () => run,
    check: vi.fn(async () => overview),
    prepare: vi.fn(async () => {
      run = { phase: "preview" } as unknown as OfficialPublishRun;
      return {} as never;
    }),
    confirm: vi.fn(async (loadKey: () => Promise<KeyObject | null>) => {
      const key = await loadKey();
      keys.push(key);
      return key ? { id: "tavora.notes", version: "1.2.3", sha256: "a".repeat(64), commit: "c".repeat(40) } : null;
    }),
    cancel: vi.fn(async () => {
      run = { phase: "idle" };
    }),
    setRun: (next: OfficialPublishRun) => (run = next),
    keys,
  };
  return publisher;
}

function setup(options: Partial<OfficialPublishingOptions> = {}, publisher = fakePublisher()) {
  const trusted = new Set<string>();
  let saved: KeyObject | null = null;
  const keys = {
    load: vi.fn(async () => saved),
    forget: vi.fn(async () => {
      saved = null;
    }),
    save: vi.fn(async (key: KeyObject) => {
      saved = key;
    }),
    canRemember: () => true,
    canRememberNow: async () => true,
    hasKey: () => saved !== null,
  };
  const changed = vi.fn();
  const pickKeyFile = vi.fn(async (): Promise<string | undefined> => undefined);
  const made = vi.fn((): OfficialPublisherPort => publisher);
  const publishing = new OfficialPublishing({
    packaged: false,
    pinsOn: true,
    trust: () => ({ keyTrusted: (fp) => trusted.has(fp), signerTrusted: () => true }),
    publisher: made,
    keys,
    pickKeyFile,
    language: () => "en",
    changed,
    ...options,
  });
  return { publishing, publisher, made, keys, changed, pickKeyFile, trust: (key: KeyObject) => trusted.add(fingerprint(key)), save: (key: KeyObject) => (saved = key) };
}

describe("OfficialPublishing outside a development build", () => {
  it("publishes built-in modules only from a development build with the pins set", async () => {
    for (const build of [{ packaged: true, pinsOn: true }, { packaged: false, pinsOn: false }]) {
      const { publishing, made, keys } = setup(build);
      expect(publishing.view()).toMatchObject({ available: false, key: { saved: false, canRemember: false } });
      await publishing.check();
      expect(made).not.toHaveBeenCalled();
      await expect(publishing.prepare("tavora.notes")).rejects.toMatchObject({ key: "officialPublish.error.notBuiltIn" });
      await expect(publishing.confirm(false)).rejects.toMatchObject({ key: "officialPublish.error.notPrepared" });
      expect(keys.load).not.toHaveBeenCalled();
    }
  });
});

describe("OfficialPublishing.check", () => {
  it("shows the list it worked out, and keeps it while the next check runs", async () => {
    const overview = { rows: [{ id: "tavora.notes", name: "Notes" }] } as unknown as OfficialPublishOverview;
    const { publishing, changed } = setup({}, fakePublisher(overview));
    await publishing.check();
    expect(publishing.view()).toMatchObject({ available: true, check: { phase: "idle" }, overview, run: { phase: "idle" } });
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("says why the check failed, in the user's words for a known problem", async () => {
    const publisher = fakePublisher();
    publisher.check.mockRejectedValueOnce(new UserError("error.unreachable"));
    const { publishing } = setup({}, publisher);
    await publishing.check();
    expect(publishing.view().check).toMatchObject({ phase: "failed", error: expect.any(String) });
    expect(publishing.view().check).not.toMatchObject({ error: "error.unreachable" });
  });

  it("waits while a build runs: both fetch in the same checkout", async () => {
    const publisher = fakePublisher();
    const { publishing } = setup({}, publisher);
    await publishing.check();
    publisher.setRun({ phase: "building" } as unknown as OfficialPublishRun);
    await publishing.check();
    expect(publisher.check).toHaveBeenCalledTimes(1);
  });
});

describe("OfficialPublishing.prepare", () => {
  it("builds under the name the list shows, once at a time", async () => {
    const overview = { rows: [{ id: "tavora.notes", name: "Notes" }] } as unknown as OfficialPublishOverview;
    const publisher = fakePublisher(overview);
    const { publishing } = setup({}, publisher);
    await publishing.check();
    await publishing.prepare("tavora.notes");
    expect(publisher.prepare).toHaveBeenCalledWith("tavora.notes", undefined, "Notes");
    await expect(publishing.prepare("tavora.todos")).rejects.toMatchObject({ key: "officialPublish.error.busy" });
  });

  it("ends quietly when the build was cancelled", async () => {
    const publisher = fakePublisher();
    publisher.prepare.mockRejectedValueOnce(new PublishCancelled());
    const { publishing } = setup({}, publisher);
    await expect(publishing.prepare("tavora.notes")).resolves.toBeUndefined();
  });
});

describe("OfficialPublishing.confirm", () => {
  it("signs with the saved key while it may still sign", async () => {
    const { publishing, publisher, trust, save, pickKeyFile } = setup();
    const key = newKey();
    trust(key);
    save(key);
    await publishing.prepare("tavora.notes");
    expect(await publishing.confirm(false)).toBe("tavora.notes 1.2.3");
    expect(publisher.keys).toEqual([key]);
    expect(pickKeyFile).not.toHaveBeenCalled();
  });

  it("forgets a saved key that is no longer trusted, and asks for the key file instead", async () => {
    const { publishing, publisher, keys, trust, save, pickKeyFile, changed } = setup();
    save(newKey());
    const picked = newKey();
    trust(picked);
    pickKeyFile.mockResolvedValueOnce(await keyFile(picked));
    await publishing.prepare("tavora.notes");
    changed.mockClear();
    expect(await publishing.confirm(false)).toBe("tavora.notes 1.2.3");
    expect(keys.forget).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalled();
    expect(fingerprint(publisher.keys[0]!)).toBe(fingerprint(picked));
    // Not asked to keep it: nothing is saved.
    expect(keys.save).not.toHaveBeenCalled();
    expect(publishing.view().key.saved).toBe(false);
  });

  it("keeps a picked key only when asked, and only once it is Tavora's", async () => {
    const wrong = setup();
    wrong.pickKeyFile.mockResolvedValueOnce(await keyFile(newKey()));
    await wrong.publishing.prepare("tavora.notes");
    await expect(wrong.publishing.confirm(true)).rejects.toMatchObject({ key: "officialPublish.error.wrongKey" });
    expect(wrong.keys.save).not.toHaveBeenCalled();

    const right = setup();
    const key = newKey();
    right.trust(key);
    right.pickKeyFile.mockResolvedValueOnce(await keyFile(key));
    await right.publishing.prepare("tavora.notes");
    await right.publishing.confirm(true);
    expect(right.keys.save).toHaveBeenCalledTimes(1);
    expect(right.publishing.view().key.saved).toBe(true);
  });

  it("publishes nothing when no key file was picked, and says so for one that isn't there", async () => {
    const { publishing, publisher, pickKeyFile } = setup();
    await publishing.prepare("tavora.notes");
    expect(await publishing.confirm(false)).toBeUndefined();
    expect(publisher.keys).toEqual([null]);
    pickKeyFile.mockResolvedValueOnce(path.join(tmpdir(), "no-such-tavora-key.pem"));
    await expect(publishing.confirm(false)).rejects.toMatchObject({ key: "officialPublish.error.key", params: { message: "there is no key file there" } });
  });
});

describe("OfficialPublishing.cancel, forgetKey and quit", () => {
  it("cancels the run, forgets the saved key, and stops the publisher when Tavora quits", async () => {
    const { publishing, publisher, keys, save, changed } = setup();
    publishing.quit();
    expect(publisher.cancel).not.toHaveBeenCalled();
    await publishing.prepare("tavora.notes");
    await publishing.cancel();
    expect(publisher.cancel).toHaveBeenCalledTimes(1);
    save(newKey());
    changed.mockClear();
    await publishing.forgetKey();
    expect(keys.forget).toHaveBeenCalled();
    expect(changed).toHaveBeenCalledTimes(1);
    publishing.quit();
    expect(publisher.cancel).toHaveBeenCalledTimes(2);
  });
});
