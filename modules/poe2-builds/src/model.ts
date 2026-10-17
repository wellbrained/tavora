export interface Gem {
    id: string;
    name: string;
    attributes: string[];
    isSupport: boolean;
    lineage?: boolean;
    levels?: number[];
    supports?: Gem[];
    tags?: string[];
}
export interface Item {
    inventory_id: string;
    slot_x?: number;
    name: string;
    base?: string;
    mods: string[];
    rarity?: string;
    reference?: boolean;
    exact?: boolean;
    level?: number;
}
export interface Stage {
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
    id: string;
    fileId: string;
    title: string;
    shortTitle: string;
    source: string;
    version: string;
    treeVersion: string;
    ascendancy: string;
    guideUrl: string;
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
export function guideSectionIndex(sections: GuideSection[], context: string, text?: string): number {
    const exact = text ? sections.findIndex(s => s.text.includes(text.trim())) : -1;
    return Math.max(0, exact >= 0 ? exact : sections.findIndex(s => s.context === context));
}
