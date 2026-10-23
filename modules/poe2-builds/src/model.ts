import { t, type Key } from './i18n';
export interface Gem {
    id: string;
    name: string;
    attributes: string[];
    isSupport: boolean;
    lineage?: boolean;
    levels?: number[];
    level?: number;
    quality?: number;
    supports?: Gem[];
    tags?: string[];
}
export interface ItemProperty { name: string; values: [string,number][]; displayMode?:number }
export interface AffixRow { text:string; type:'P'|'S'; id:string; instanceId?:string; name?:string; tier?:number; /** How many tiers the base has for this mod; 1 is the best. */ tiers?:number; /** The section of a row worked out on display; saved rows have none. */ kind?:string; status?:string; evidence?:string; hybrid?:'start'|'middle'|'end'; contributors?:AffixRow[] }
export interface QuestChoice { quest:string; act:string; area:string; reward:string }
export interface Item {
    sourceText?: string;
    sourceModifiers?: {kind:string;id:string;stats:Record<string,number>}[];
    sourceSections?: {kind:string;mods:string[]}[];
    properties?:ItemProperty[];
    requirements?:ItemProperty[];
    grantedSkills?:ItemProperty[];
    affixRows?:AffixRow[];
    itemLevel?:number;
    corrupted?:boolean;
    dps?:number;
    category?: string;
    sourceBase?: string;
    sourceUnique?: string;
    sourceLabel?: string;
    inventory_id: string;
    slot_x?: number;
    name: string;
    base?: string;
    mods: string[];
    rarity?: string;
    reference?: boolean;
    exact?: boolean;
    level?: number;
    level_interval?: number[];
    quality?: number;
    sourceStats?: Record<string, number | string | boolean>;
}
export interface Stage {
    /** Which panel lists this variant; unset or active means all. Guides use tree and skills when they don't pair a tree with a gem setup. */
    characterProfile?: 'active' | 'gear' | 'skills' | 'tree';
    ascendancy?: string;
    treeVersion?: string;
    weaponSet?: 1 | 2;
    questRecommendations?:{text:string;quest?:string}[];
    name: string;
    label: string;
    author: string;
    items: Item[];
    skills: Gem[];
    passives: {
        id: string;
        weapon: number;
    }[];
    link?: string;
}
export interface GuideSection {
    title: string;
    text: string;
    context?: string;
}
export interface Guide {
    stageNotes?: Record<string, { gear?: string; skills?: string; tree?: string }>;
    url?: string;
    mana?: string;
    variants?: Record<string, string>;
    tree?: string;
    gear?: string;
    skills?: string;
    sections?: GuideSection[];
    items?: Record<string, string>;
    gems?: Record<string, string>;
    crafting?: Record<string, {
        label: string;
        text: string;
    }>;
}
export interface Build {
    /** Public source document only, retained for portable reprocessing without re-fetching. */
    guideExport?: string;
    guideImport?: {source:'Mobalytics'|'PoE Vault';url:string;documentId:string;revision:string;importedAt:string;variantIds:string[]};
    character?: Character;
    characterExport?: string;
    questSelections?:QuestChoice[];
    questStats?:string[];
    id: string;
    fileId: string;
    title: string;
    shortTitle: string;
    source: string;
    version: string;
    treeVersion: string;
    ascendancy: string;
    guideUrl: string;
    video?: string;
    importNotes?: string[];
    /** Which source adapter produced the build, with the game patches it supports. */
    importerVersion?: string;
    guideText: Guide | null;
    stages: Stage[];
    defaultStage: number;
}
export interface Character {
    name: string;
    class: string;
    level: number;
    source: 'poe.ninja' | 'PoB';
    importedAt: string;
    url?: string;
    account?: string;
    league?: string;
}
export interface Portable {
    format: 'tavora.build';
    formatVersion: 1;
    buildId: string;
    savedAt: string;
    build: Build;
    guideText: Guide | null;
}
export const MAX_FILE_BYTES = 24 * 1024 * 1024;
// Item classes such as Helmet or Flask are game names and stay English; where a slot sits is ours to translate.
const slotKeys: Record<string, Key> = { Weapon1: 'slot.mainWeapon', Weapon2: 'slot.weaponSwap', Offhand1: 'slot.offhandQuiver', Offhand2: 'slot.swapOffhand', Ring1: 'slot.leftRing', Ring2: 'slot.rightRing' };
const slotClasses: Record<string, string> = { Helm1: 'Helmet', BodyArmour1: 'Body armour', Gloves1: 'Gloves', Boots1: 'Boots', Amulet1: 'Amulet', Belt1: 'Belt', Flask1: 'Flask', Flask2: 'Flask', Charm1: 'Charm', Charm2: 'Charm', Charm3: 'Charm' };
/** What a slot is called, or undefined for an unknown slot. */
export function slotName(id: string): string | undefined { const key = Object.hasOwn(slotKeys, id) ? slotKeys[id] : undefined; return key ? t(key) : Object.hasOwn(slotClasses, id) ? slotClasses[id] : undefined; }
export function portable(build: Build): Portable { return { format: 'tavora.build', formatVersion: 1, buildId: build.fileId, savedAt: new Date().toISOString(), build, guideText: build.guideText }; }
export function guideSections(guide: Guide | null, stages: Stage[] = []): GuideSection[] {
    if (!guide)
        return [];
    if (guide.sections?.length)
        return guide.sections;
    const sections: GuideSection[] = [];
    for (const [context, title] of [['tree', t('guide.passiveTree')], ['skills', t('guide.skills')], ['gear', t('guide.equipment')]] as const) {
        const text = guide[context];
        if (text)
            sections.push({ title, text, context });
    }
    for (const [slot, text] of Object.entries(guide.items || {}))
        sections.push({ title: slotName(slot) || t('guide.equipmentNotes'), text, context: 'gear' });
    for (const entry of Object.values(guide.crafting || {}))
        sections.push({ title: entry.label, text: entry.text, context: 'gear' });
    for (const [id, text] of Object.entries(guide.gems || {}))
        sections.push({ title: stages.flatMap(s => s.skills).find(g => g.id === id)?.name || t('guide.skillNotes'), text, context: 'skills' });
    if (guide.mana)
        sections.push({ title: t('guide.mana'), text: guide.mana, context: 'gear' });
    for (const [key, text] of Object.entries(guide.variants || {}))
        if (typeof text === 'string')
            sections.push({ title: stages[Number(key)]?.label || key, text, context: 'overview' });
    return sections;
}

/** Prefer the exact note's section, then the panel's general section. */
export function guideSectionIndex(sections: GuideSection[], context: string, text?: string, variant?: string): number {
    const variantChapter = variant ? sections.findIndex(s => s.context === context && s.title.toLowerCase().endsWith(' · ' + variant.toLowerCase())) : -1;
    if (variantChapter >= 0) return variantChapter;
    const exact = text ? sections.findIndex(s => s.text.includes(text.trim())) : -1;
    return Math.max(0, exact >= 0 ? exact : sections.findIndex(s => s.context === context));
}

/** A missing note in a captured variant stays absent; never borrow another variant. */
export function guideNote(guide: Guide | null, index: number, context: 'gear' | 'skills' | 'tree'): string | undefined {
    return guide?.stageNotes ? guide.stageNotes[String(index)]?.[context] : guide?.[context];
}
