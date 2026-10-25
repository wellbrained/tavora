// An installed module as the module page shows it (CatalogModuleDialog.vue): the same fields a catalog
// listing has, filled from what the module's own manifest says. What only a listing knows (size, installs,
// rating, screenshots to fetch) stays empty; the page fills in the readme and pictures from the module's folder.
import type { CatalogModuleView, HostViewState } from "../shared/host-api";

export type InstalledModule = HostViewState["modules"][number];

export function pageModule(module: InstalledModule): CatalogModuleView {
  return {
    id: module.id,
    name: module.name,
    description: module.description,
    version: module.version,
    minTavora: null,
    permissions: module.permissions.asks,
    owner: module.publisher ?? "",
    publisher: module.publisherName,
    size: 0,
    installs: 0,
    fits: module.available,
    forGames: [],
    publishedAt: "",
    homepage: null,
    screenshots: 0,
    icon: module.icon !== null,
    rating: null,
  };
}
