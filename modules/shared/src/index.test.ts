import { TavoraError, type JsonValue, type TavoraSDK } from "@tavora/sdk";
import { describe, expect, it } from "vitest";
import { serial, updateDocument } from "./documents";
import { applyTheme } from "./theme";

/** A stand-in for the host's documents with revisions and CONFLICT. */
function fakeDocuments(initial: { data: JsonValue; revision: number } | null) {
  let stored = initial;
  const puts: number[] = [];
  const sdk = {
    documents: {
      get: async () => (stored ? { id: "d", title: "", updatedAt: "U", bytes: 0, ...stored } : null),
      put: async ({ data, ifRevision }: { data: JsonValue; ifRevision?: number }) => {
        puts.push(ifRevision ?? -1);
        const current = stored?.revision ?? 0;
        if (ifRevision !== current) throw new TavoraError({ code: "CONFLICT", message: "conflict", revision: current });
        stored = { data, revision: current + 1 };
        return { id: "d", title: "", revision: current + 1, updatedAt: "U", bytes: 0 };
      },
    },
  } as unknown as TavoraSDK;
  return { sdk, puts, stored: () => stored, change: (data: JsonValue) => (stored = { data, revision: (stored?.revision ?? 0) + 1 }) };
}

const parse = (raw: JsonValue | null) => (Array.isArray(raw) ? (raw as string[]) : []);

describe("updateDocument", () => {
  it("creates a missing document", async () => {
    const docs = fakeDocuments(null);
    const saved = await updateDocument(docs.sdk, "d", { parse, change: (list) => void list.push("a"), title: () => "T" });
    expect(saved).toEqual({ data: ["a"], revision: 1, updatedAt: "U" });
    expect(docs.puts).toEqual([0]);
  });

  it("re-applies the change when another panel saved first", async () => {
    const docs = fakeDocuments({ data: ["a"], revision: 1 });
    const known = { data: ["a"], revision: 1 };
    docs.change(["a", "theirs"]);
    const saved = await updateDocument(docs.sdk, "d", { parse, change: (list) => void list.push("mine"), title: () => "T", known });
    expect(saved.data).toEqual(["a", "theirs", "mine"]);
    expect(docs.puts).toEqual([1, 2]);
    // The panel's own copy is never changed in place.
    expect(known.data).toEqual(["a"]);
  });

  it("gives up after a few conflicts in a row", async () => {
    const docs = fakeDocuments({ data: [], revision: 1 });
    const change = (list: string[]) => {
      docs.change(["someone else"]);
      list.push("mine");
    };
    await expect(updateDocument(docs.sdk, "d", { parse, change, title: () => "T" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(docs.puts).toHaveLength(5);
  });
});

describe("serial", () => {
  it("runs jobs one after another, even when one fails", async () => {
    const run = serial();
    const order: string[] = [];
    const slow = run(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("slow");
      throw new Error("boom");
    });
    const fast = run(async () => void order.push("fast"));
    await expect(slow).rejects.toThrow("boom");
    await fast;
    expect(order).toEqual(["slow", "fast"]);
  });
});

describe("applyTheme", () => {
  it("sets the tokens, the colour scheme and the dark class the components' dark: styles use", () => {
    const props = new Map<string, string>();
    const classes = new Set<string>(["dark"]);
    const root = {
      style: { setProperty: (name: string, value: string) => props.set(name, value), colorScheme: "" },
      classList: { toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)) },
      setAttribute: () => {},
    } as unknown as HTMLElement;
    applyTheme({ mode: "light", radius: 6, tokens: { primary: "#2a5f9e" } } as never, root);
    expect(props.get("--primary")).toBe("#2a5f9e");
    expect(props.get("--radius")).toBe("6px");
    expect(root.style.colorScheme).toBe("light");
    expect(classes.has("dark")).toBe(false);
    applyTheme({ mode: "dark", radius: 8, tokens: {} } as never, root);
    expect(classes.has("dark")).toBe(true);
  });
});
