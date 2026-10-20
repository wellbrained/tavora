import { expect, it } from "vitest";
import { TavoraError, type TavoraSDK } from "@tavora/sdk";
import { BuildRepository } from "./repository";
import { portable } from "./model";
it("keeps concurrent changes intact and reloads saved build data", async () => {
  let doc = {
    id: "enshrouded-test",
    title: "Mage",
    revision: 2,
    data: portable({ name: "Mage", selection: {} }),
  };
  const sdk = {
    documents: {
      get: async () => structuredClone(doc),
      put: async (p: any) => {
        if (p.ifRevision !== doc.revision)
          throw new TavoraError({ code: "CONFLICT", message: "stale" });
        doc = { ...doc, ...p, revision: doc.revision + 1 };
        return doc;
      },
    },
  } as unknown as TavoraSDK;
  const repo = new BuildRepository(sdk);
  await expect(
    repo.update(doc.id, (b) => ({ ...b, name: "Old name" }), 1),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(doc.title).toBe("Mage");
  await repo.update(doc.id, (b) => ({ ...b, name: "New name" }), 2);
  expect((await new BuildRepository(sdk).get(doc.id)).build.name).toBe(
    "New name",
  );
});
