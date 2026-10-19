export interface View {
    build: string | null;
    stage: number;
    section: number;
    weapon: 'all' | '1' | '2';
    search: string;
    notes: boolean;
    disclosures: Record<string, boolean>;
    treeInfo: boolean;
    decorativeFrames: boolean;
    nodeNames: boolean;
    equipmentList: boolean;
    inventory: boolean;
    gearWeapon: 1 | 2;
    guideSidebar: boolean;
    guideExpanded: boolean;
    guideChapters: Record<string, boolean>;
}

/** Older alphas only saved build, variant and Guide section. */
export function restoreView(value: unknown): View {
    const v = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const index = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : 0;
    return {
        build: typeof v.build === 'string' ? v.build : null,
        stage: index(v.stage), section: index(v.section),
        weapon: v.weapon === '1' || v.weapon === '2' ? v.weapon : 'all',
        search: typeof v.search === 'string' ? v.search.slice(0, 200) : '',
        notes: v.notes === true,
        disclosures: Object.fromEntries(Object.entries(v.disclosures && typeof v.disclosures === 'object' ? v.disclosures : {}).filter(([key, val]) => key.length < 250 && typeof val === 'boolean').slice(0, 500)) as Record<string, boolean>,
        treeInfo: v.treeInfo === true,
        decorativeFrames: v.decorativeFrames === true,
        nodeNames: v.nodeNames !== false,
        equipmentList: v.equipmentList !== false,
        inventory: v.inventory !== false,
        gearWeapon: v.gearWeapon === 2 ? 2 : 1,
        guideSidebar: v.guideSidebar !== false,
        guideExpanded: v.guideExpanded !== false,
        guideChapters: Object.fromEntries(Object.entries(v.guideChapters && typeof v.guideChapters === 'object' ? v.guideChapters : {}).filter(([key, val]) => key.length < 100 && typeof val === 'boolean').slice(0, 2000)) as Record<string, boolean>,
    };
}
