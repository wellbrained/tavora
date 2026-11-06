// Placeholder data for the catalog's skeletons (Skeleton in the kit): the real cards and the real page, filled with
// made-up modules whose texts are about as long as real ones, so the bars have the real boxes. Never shown as text.
import { placeholderText } from "@tavora/official-ui/components/ui/skeleton";
import type { CatalogModuleView, ReadmeBlock } from "../shared/host-api";

/** A made-up module for a card or a page; `index` makes ids and lengths differ a little, like real ones. */
export function placeholderModule(index: number): CatalogModuleView {
  return {
    id: `placeholder.${index}`,
    name: placeholderText(10 + ((index * 5) % 9)),
    description: placeholderText(90 + ((index * 23) % 50)),
    version: "0.0.0",
    minTavora: null,
    permissions: { network: [], connectors: [], folders: [] },
    owner: "placeholder",
    publisher: placeholderText(8 + (index % 5)),
    size: 0,
    installs: 0,
    fits: true,
    forGames: [],
    gameIds: [],
    official: false,
    publishedAt: "",
    homepage: null,
    support: null,
    screenshots: 0,
    icon: false,
    rating: null,
  };
}

/** The cards shown while the list loads: enough to fill a window. */
export const PLACEHOLDER_MODULES: CatalogModuleView[] = Array.from({ length: 8 }, (_, index) => placeholderModule(index));

const words = (length: number) => [{ text: placeholderText(length) }];

/** A module page's readme while it loads: an overview and a list of features, tall enough to fill the page's fold. */
export const PLACEHOLDER_README: ReadmeBlock[] = [
  { kind: "paragraph", spans: words(150) },
  { kind: "paragraph", spans: words(110) },
  // Only the key that sorts the list into the page's Features section; the page shows its own translated title, never this.
  { kind: "heading", level: 2, text: "Features" },
  { kind: "list", ordered: false, items: [60, 80, 50, 70, 40].map((length) => ({ spans: words(length) })) },
];
