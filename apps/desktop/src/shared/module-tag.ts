// The small tag a module carries in Add module and Settings: where this copy of it came from. Players
// mostly see Official, Catalog and From file; module authors also see Local (work in progress in a
// development folder), Release (the copy they publish) and Example.

export type ModuleTag = "official" | "catalog" | "file" | "local" | "release" | "example";

export interface TaggedModule {
  id: string;
  provenance: "official" | "local";
  origin: { kind: "official" | "example" | "own" | "dev" };
  fromCatalog: boolean;
}

export function moduleTag(module: TaggedModule): ModuleTag {
  if (module.origin.kind === "example") return "example";
  if (module.provenance === "official") return "official";
  // A development folder: a local.… id is work in progress, any other id is a release copy to publish.
  if (module.origin.kind === "dev") return module.id.startsWith("local.") ? "local" : "release";
  return module.fromCatalog ? "catalog" : "file";
}

/** The text key of each tag (common.*). */
export const MODULE_TAG_TEXT = {
  official: "common.official",
  catalog: "common.catalog",
  file: "common.fromFile",
  local: "common.local",
  release: "common.release",
  example: "common.example",
} as const satisfies Record<ModuleTag, string>;
