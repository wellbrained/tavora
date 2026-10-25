import { describe, expect, it } from "vitest";
import type { ModulePermissions } from "./host-api";
import { asksMore, updateAllPlan, waitingUpdates, type WaitingUpdate } from "./module-updates";

const none = { network: [], connectors: [] };
const module = (id: string, name: string, asks: ModulePermissions | null): WaitingUpdate => ({
  id,
  name,
  update: asks ? { version: "2.0.0", asks } : null,
});

describe("module updates", () => {
  const modules = [
    module("b.hosts", "Beta", { network: ["api.example.com"], connectors: [] }),
    module("a.plain", "Alpha", none),
    module("c.idle", "Gamma", null),
    module("d.connector", "Delta", { network: [], connectors: ["discord"] }),
    module("e.plain", "Epsilon", none),
  ];

  it("lists only modules with an update, by name", () => {
    expect(waitingUpdates(modules).map((item) => item.id)).toEqual(["a.plain", "b.hosts", "d.connector", "e.plain"]);
  });

  it("tells updates that need a yes from those that do not", () => {
    expect(asksMore({ asks: none })).toBe(false);
    expect(asksMore({ asks: { network: ["api.example.com"], connectors: [] } })).toBe(true);
    expect(asksMore({ asks: { network: [], connectors: ["discord"] } })).toBe(true);
  });

  it("updates the plain ones first, then asks for each of the others in list order", () => {
    expect(updateAllPlan(modules)).toEqual({ now: ["a.plain", "e.plain"], ask: ["b.hosts", "d.connector"] });
    expect(updateAllPlan([])).toEqual({ now: [], ask: [] });
  });
});
