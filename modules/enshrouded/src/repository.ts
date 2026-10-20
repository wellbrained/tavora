import { TavoraError, type TavoraSDK } from "@tavora/sdk";
import { readBuild, portable, type Build } from "./model";
export class BuildRepository {
  constructor(private sdk: TavoraSDK) {}
  async list() {
    return (await this.sdk.documents.list()).filter((d) =>
      d.id.startsWith("enshrouded-"),
    );
  }
  async get(id: string) {
    const doc = await this.sdk.documents.get(id);
    if (!doc) throw Error("This build is unavailable. Choose another build.");
    return { build: readBuild(doc.data), revision: doc.revision };
  }
  async create(build: Build) {
    const id = "enshrouded-" + crypto.randomUUID();
    await this.sdk.documents.put({
      id,
      title: build.name,
      data: portable(build),
      ifRevision: 0,
    });
    return id;
  }
  async update(
    id: string,
    change: (build: Build) => Build,
    expectedRevision: number,
  ) {
    const current = await this.get(id);
    if (current.revision !== expectedRevision)
      throw new TavoraError({
        code: "CONFLICT",
        message:
          "This build changed in another panel. The latest copy is open; try your change again.",
      });
    const next = change(current.build);
    await this.sdk.documents.put({
      id,
      title: next.name,
      data: portable(next),
      ifRevision: current.revision,
    });
    return { build: next, revision: current.revision + 1 };
  }
}
