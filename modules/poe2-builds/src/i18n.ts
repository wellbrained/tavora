import { createTranslator } from '@tavora/official-ui/i18n';
import { de, en, type Key } from './locales';

/** PoE 2 Builds' texts, in the language Tavora reports. */
export const { t, plural, language, setLanguage, locale } = createTranslator<Key>(en, de);

/** A date and time in the language shown. */
export const dateTime = (iso: string) => new Date(iso).toLocaleString(locale());
/** A number with the separators of the language shown. */
export const number = (value: number) => value.toLocaleString(locale());

// Import notes are saved in English with the build, so a file reads the same on every PC.
// Known notes are shown in the language picked now; anything else stays as written.
const notes: [RegExp, (m: RegExpExecArray) => string][] = [
 [/^(.+) adapter (\S+) · patch (.+)$/, m => t('note.importer', { source: m[1]!, version: m[2]!, patches: m[3]! })],
 [/^Attribute picks on (\d+) passive nodes? are saved but not shown yet\.$/, m => plural('note.attributes', Number(m[1]))],
 [/^The guide doesn't say which attribute to take on (\d+) of them\.$/, m => t('note.openAttributes', { count: m[1]! })],
 [/^Jewels in (\d+) tree sockets? are saved but not shown yet\.$/, m => plural('note.jewels', Number(m[1]))],
 [/^(\d+) soul cores and runes are saved but not shown yet\.$/, m => t('note.cores', { count: m[1]! })],
 [/^Gem setups from the patch (.+) planner are shown as the guide lists them\.$/, m => t('note.olderGems', { patches: m[1]! })],
 [/^Gem setups from planner version (.+) can't be read yet and were left out\.$/, m => t('note.unreadableGems', { versions: m[1]! })],
 [/^(\d+) gems? in the planner (?:aren't|isn't) in Tavora's data and (?:were|was) left out\.$/, m => plural('note.unknownGems', Number(m[1]))],
 [/^(\d+) passive trees? uses? an older planner link and (?:was|were) left out\.$/, m => plural('note.oldTrees', Number(m[1]))],
 [/^Not displayed: equipment slot (.+)\.$/, m => t('note.pobSlot', { slot: m[1]! })],
];
const fixed = ['plannerGaps', 'uniqueRanges', 'noGearPlanner', 'unpaired', 'ninjaSnapshot', 'plannerOnly', 'pobPlanned', 'pobBlank', 'pobJewels'] as const;
// Older wording saved with builds from before affix tiers were worked out on display.
const reworded: Record<string, Key> = {
 "Uniques without exact rolls use labelled PoB reference ranges. Affix tiers the guide doesn't give are left out, never guessed.": 'note.uniqueRanges',
 'Unresolved affix tiers and item properties are left blank.': 'note.pobBlank',
};

/** An import note in the language shown. */
export function noteText(note: string): string {
 const known = fixed.find(key => en[`note.${key}`] === note);
 if (known) return t(`note.${known}`);
 if (Object.hasOwn(reworded, note)) return t(reworded[note]!);
 for (const [pattern, text] of notes) { const m = pattern.exec(note); if (m) return text(m); }
 return note;
}
export type { Key };

// Names an importer gives a variant when the source has none. Saved in English like the notes.
const variantNames: Record<string, Key> = { 'Active setup': 'variant.active', 'Attached build': 'variant.attached', 'Passive tree': 'guide.passiveTree' };
/** A variant's name in the language shown; names from a guide or PoB stay as written. */
export const variantName = (label: string) => Object.hasOwn(variantNames, label) ? t(variantNames[label]!) : label;
