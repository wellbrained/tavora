import type { ReadmeBlock } from "./host-api";

/** The sections a module page knows, in the order it shows them. Overview has no heading in the readme. */
export const README_SECTIONS = ["overview", "features", "usage", "settings", "requirements", "issues"] as const;
export type ReadmeSectionId = (typeof README_SECTIONS)[number];

/** Headings that name a known section, in English and German, compared in lower case. */
const NAMES: Record<Exclude<ReadmeSectionId, "overview">, string[]> = {
  features: ["features", "funktionen", "features und funktionen"],
  usage: ["how to use", "usage", "bedienung", "so geht's", "so gehts", "verwendung", "anleitung"],
  settings: ["settings", "options", "einstellungen", "optionen"],
  requirements: ["requirements", "voraussetzungen", "anforderungen"],
  issues: ["known issues", "bekannte probleme", "bekannte fehler"],
};

export interface ReadmeSections {
  /** Known sections that have content, in the fixed order. */
  known: { id: ReadmeSectionId; blocks: ReadmeBlock[] }[];
  /** Everything else: sections with other headings, in the order written. */
  more: { title: string; blocks: ReadmeBlock[] }[];
}

function knownId(title: string): Exclude<ReadmeSectionId, "overview"> | null {
  const name = title.toLowerCase().replace(/[:.!?]+$/, "").trim();
  for (const id of Object.keys(NAMES) as (keyof typeof NAMES)[]) if (NAMES[id].includes(name)) return id;
  return null;
}

/**
 * Sorts a readme into the template's sections. The text before the first heading is the Overview; a
 * first heading of level 1 only names the module and is left out. A heading of level 1 or 2 starts a
 * section (known by name, else "More"); level 3 headings stay inside the section they are in. A known
 * heading written twice joins into one section. Without any template everything lands in Overview/More.
 */
export function sortReadme(blocks: readonly ReadmeBlock[]): ReadmeSections {
  const known = new Map<ReadmeSectionId, ReadmeBlock[]>();
  const more: { title: string; blocks: ReadmeBlock[] }[] = [];
  let target: ReadmeBlock[] = [];
  known.set("overview", target);
  let seenAnything = false;
  for (const block of blocks) {
    if (block.kind === "heading" && block.level <= 2) {
      if (block.level === 1 && !seenAnything) continue;
      const id = knownId(block.text);
      if (id) {
        target = known.get(id) ?? [];
        known.set(id, target);
      } else {
        target = [];
        more.push({ title: block.text, blocks: target });
      }
      seenAnything = true;
      continue;
    }
    seenAnything = true;
    target.push(block);
  }
  return {
    known: README_SECTIONS.flatMap((id) => {
      const found = known.get(id);
      return found?.length ? [{ id, blocks: found }] : [];
    }),
    more: more.filter((section) => section.blocks.length > 0),
  };
}

/** What the Publish preview points out when the readme lacks the two sections every page should have. */
export function missingSections(blocks: readonly ReadmeBlock[]): ("overview" | "features")[] {
  const { known } = sortReadme(blocks);
  return (["overview", "features"] as const).filter((id) => !known.some((section) => section.id === id));
}
