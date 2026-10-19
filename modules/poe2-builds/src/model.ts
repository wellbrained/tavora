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
export interface AffixRow { text:string; type:'P'|'S'; id:string; instanceId?:string; name?:string; tier?:number; status?:string; evidence?:string; hybrid?:'start'|'middle'|'end'; contributors?:AffixRow[] }
export interface QuestChoice { quest:string; act:string; area:string; reward:string }
export interface Item {
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
    guideText: Guide | null;
    stages: Stage[];
    defaultStage: number;
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
export const slots: Record<string, string> = { Weapon1: 'Main weapon', Weapon2: 'Weapon swap', Offhand1: 'Offhand / quiver', Offhand2: 'Swap offhand', Helm1: 'Helmet', BodyArmour1: 'Body armour', Gloves1: 'Gloves', Boots1: 'Boots', Amulet1: 'Amulet', Belt1: 'Belt', Ring1: 'Left ring', Ring2: 'Right ring', Flask1: 'Flask', Flask2: 'Flask', Charm1: 'Charm', Charm2: 'Charm', Charm3: 'Charm' };
export function portable(build: Build): Portable { return { format: 'tavora.build', formatVersion: 1, buildId: build.fileId, savedAt: new Date().toISOString(), build, guideText: build.guideText }; }
export function guideSections(guide: Guide | null, stages: Stage[] = []): GuideSection[] {
    if (!guide)
        return [];
    if (guide.sections?.length)
        return guide.sections;
    const sections: GuideSection[] = [];
    for (const [context, title] of [['tree', 'Passive tree'], ['skills', 'Skills'], ['gear', 'Equipment']] as const) {
        const text = guide[context];
        if (text)
            sections.push({ title, text, context });
    }
    for (const [slot, text] of Object.entries(guide.items || {}))
        sections.push({ title: slots[slot] || 'Equipment notes', text, context: 'gear' });
    for (const entry of Object.values(guide.crafting || {}))
        sections.push({ title: entry.label, text: entry.text, context: 'gear' });
    for (const [id, text] of Object.entries(guide.gems || {}))
        sections.push({ title: stages.flatMap(s => s.skills).find(g => g.id === id)?.name || 'Skill notes', text, context: 'skills' });
    if (guide.mana)
        sections.push({ title: 'Mana', text: guide.mana, context: 'gear' });
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
