import { effectScope } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { JsonValue } from "@tavora/sdk";
import { createMemoryHost } from "@tavora/sdk/testing";
import { useItemSession } from "./use-item-session";

interface Plan {
  name: string;
  items: string[];
}

const options = {
  prefix: "plan-",
  parse: (raw: JsonValue | null): Plan => (raw ? (raw as unknown as Plan) : { name: "New plan", items: [] }),
  title: (plan: Plan) => plan.name,
  debounceMs: 0,
};

describe("useItemSession", () => {
  it("loads, follows picks and edits, and saves on dispose", async () => {
    const { sdk, host } = createMemoryHost();
    host.documents.put({ id: "plan-a", title: "A", data: { name: "A", items: [] } });
    const scope = effectScope();
    const plans = scope.run(() => useItemSession(sdk, { ...options, debounceMs: 60_000 }))!;
    expect(plans.loaded.value).toBe(false);
    await plans.ready;
    expect(plans.loaded.value).toBe(true);
    expect(plans.items.value.map((item) => item.id)).toEqual(["plan-a"]);
    expect(plans.currentId.value).toBe("plan-a");

    plans.update((draft) => void draft.items.push("one"));
    expect(plans.current.value?.items).toEqual(["one"]);
    expect(plans.status.value).toBe("dirty");

    const id = await plans.create({ name: "B", items: [] });
    expect(plans.currentId.value).toBe(id);
    expect(plans.items.value).toHaveLength(2);
    expect((host.documents.get("plan-a")?.data as unknown as Plan).items).toEqual(["one"]);

    await plans.pick(null);
    expect(plans.current.value).toBeNull();
    await plans.pick("plan-a");
    plans.update((draft) => void draft.items.push("two"));
    scope.stop();
    await vi.waitFor(() => expect((host.documents.get("plan-a")?.data as unknown as Plan).items).toEqual(["one", "two"]));
  });

  it("reload shows a copy written through this panel's own sdk", async () => {
    const { sdk, host } = createMemoryHost();
    host.documents.put({ id: "plan-a", title: "A", data: { name: "A", items: [] } });
    const plans = useItemSession(sdk, options);
    await plans.ready;
    await sdk.documents.put({ id: "plan-a", title: "B", data: { name: "B", items: [] }, ifRevision: 1 });
    await plans.reload();
    expect(plans.current.value?.name).toBe("B");
  });

  it("queues calls made before it has loaded, and reports a session that cannot open", async () => {
    const { sdk } = createMemoryHost();
    const plans = useItemSession(sdk, options);
    const id = await plans.create({ name: "Early", items: [] });
    expect(plans.currentId.value).toBe(id);

    sdk.documents.list = async () => {
      throw new Error("cannot list");
    };
    const broken = useItemSession(sdk, options);
    await expect(broken.ready).rejects.toThrow("cannot list");
    await expect(broken.flush()).resolves.toBeUndefined();
    expect((broken.error.value as Error).message).toBe("cannot list");
    expect(broken.loaded.value).toBe(false);
  });

  it("shows busy and deleted, and brings a deleted item back", async () => {
    const a = createMemoryHost();
    const b = createMemoryHost({ share: a.host });
    a.host.documents.put({ id: "plan-a", title: "A", data: { name: "A", items: [] } });
    const plans = useItemSession(a.sdk, options);
    await plans.ready;
    let finish!: () => void;
    const running = plans.job(() => new Promise<void>((resolve) => (finish = resolve)));
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    await vi.waitFor(() => expect(plans.busy.value).toBe(true));
    finish();
    await running;
    expect(plans.busy.value).toBe(false);

    await b.sdk.documents.delete("plan-a");
    await vi.waitFor(() => expect(plans.deleted.value).toBe(true));
    expect(plans.currentId.value).toBe("plan-a");
    expect(plans.deletedCopy.value).toEqual({ name: "A", items: [] });
    await plans.restoreDeleted();
    expect(plans.deleted.value).toBe(false);
    expect(plans.deletedCopy.value).toBeNull();
    expect(a.host.documents.get("plan-a")).not.toBeNull();
    await plans.refresh();
    await plans.adoptRemote();
  });

  it("restores an edited copy", async () => {
    const a = createMemoryHost();
    const b = createMemoryHost({ share: a.host });
    a.host.documents.put({ id: "plan-a", title: "A", data: { name: "A", items: ["one"] } });
    const plans = useItemSession(a.sdk, options);
    await plans.ready;
    await b.sdk.documents.delete("plan-a");
    await vi.waitFor(() => expect(plans.deleted.value).toBe(true));
    await plans.restoreDeleted({ name: "A", items: ["one", "later"] });
    expect(plans.deleted.value).toBe(false);
    expect(plans.current.value?.items).toEqual(["one", "later"]);
  });
});
