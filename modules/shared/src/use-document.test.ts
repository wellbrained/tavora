import { effectScope } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { JsonValue } from "@tavora/sdk";
import { createMemoryHost } from "@tavora/sdk/testing";
import { useDocument } from "./use-document";

interface Plan {
  items: string[];
}

const options = { parse: (raw: JsonValue | null): Plan => (raw ? (raw as unknown as Plan) : { items: [] }), title: () => "Plan", debounceMs: 0 };

describe("useDocument", () => {
  it("loads, follows edits and another panel, and saves on dispose", async () => {
    const a = createMemoryHost();
    const b = createMemoryHost({ share: a.host });
    const scope = effectScope();
    const plan = scope.run(() => useDocument(a.sdk, "plan", { ...options, debounceMs: 60_000 }))!;
    expect(plan.loaded.value).toBe(false);
    await plan.ready;
    expect(plan.loaded.value).toBe(true);

    plan.update((draft) => void draft.items.push("one"));
    expect(plan.data.value.items).toEqual(["one"]);
    expect(plan.status.value).toBe("saving");
    await plan.flush();
    expect(plan.status.value).toBe("idle");

    await b.sdk.documents.put({ id: "plan", title: "Plan", data: { items: ["one", "two"] }, ifRevision: 1 });
    await vi.waitFor(() => expect(plan.data.value.items).toEqual(["one", "two"]));

    plan.update((draft) => void draft.items.push("three"));
    scope.stop();
    await vi.waitFor(() => expect((a.host.documents.get("plan")?.data as unknown as Plan).items).toEqual(["one", "two", "three"]));
  });

  it("holds an edit made before the document is loaded", async () => {
    const { sdk, host } = createMemoryHost();
    const plan = useDocument(sdk, "plan", options);
    plan.update((draft) => void draft.items.push("early"));
    await plan.flush();
    await vi.waitFor(() => expect((host.documents.get("plan")?.data as unknown as Plan).items).toEqual(["early"]));
  });
});
