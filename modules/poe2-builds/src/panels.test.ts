import { afterEach, expect, it, vi } from 'vitest';
import { restoreView } from './view-state';
import { guideSections, guideSectionIndex } from './model';
import { GuideLinks } from './guide-links';
import { panelMenuActions } from './panel-menus';
import type { Build } from './model';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('restores older panel states and rejects invalid saved controls', () => {
    expect(restoreView({ build: 'old-build', stage: 4, section: 2 })).toMatchObject({ build: 'old-build', stage: 4, section: 2, weapon: 'all', search: '', notes: false, disclosures: {}, treeInfo: false });
    expect(restoreView({ stage: -1, section: 2.5, weapon: '9', notes: 'yes', disclosures: { good: true, bad: 1 } })).toMatchObject({ stage: 0, section: 0, weapon: 'all', notes: false, disclosures: { good: true } });
});

it('round-trips independent filters and note disclosures', () => {
    const tree = restoreView({ build: 'a', stage: 1, weapon: '2', search: 'cold', notes: true, disclosures: { tree: false }, treeInfo: true });
    expect(restoreView(JSON.parse(JSON.stringify(tree)))).toEqual(tree);
    const skills = restoreView({ build: 'a', stage: 4 });
    expect(skills.weapon).toBe('all'); expect(skills.disclosures).toEqual({});
});

it('uses human slot names and selects the exact note before a general section', () => {
    const sections = guideSections({ gear: 'General equipment notes.', items: { Weapon1: 'Bow crafting instructions.', Offhand1: 'Quiver notes.' } });
    expect(sections.map(s => s.title)).toEqual(['Equipment', 'Main weapon', 'Offhand / quiver']);
    expect(guideSectionIndex(sections, 'gear', 'Bow crafting instructions.')).toBe(1);
    expect(guideSectionIndex(sections, 'gear', 'Unavailable note.')).toBe(0);
    expect(guideSectionIndex([], 'skills')).toBe(0);
});

it('delivers a note link to one matching Guide copy, preserving other readers', async () => {
    vi.stubGlobal('addEventListener', () => {}); vi.stubGlobal('removeEventListener', () => {});
    const now = vi.spyOn(Date, 'now'); const jumps: string[] = [];
    now.mockReturnValue(100);
    const older = new GuideLinks(() => ({ build: 'a', ready: true }), i => jumps.push('older:' + i));
    now.mockReturnValue(200);
    const newest = new GuideLinks(() => ({ build: 'a', ready: true }), i => jumps.push('newest:' + i));
    now.mockReturnValue(300);
    const otherBuild = new GuideLinks(() => ({ build: 'b', ready: true }), i => jumps.push('other:' + i));
    const sender = new GuideLinks(() => ({ build: 'a', ready: false }), () => {});
    try {
        expect(await sender.navigate('a', 3)).toBe(true);
        expect(jumps).toEqual(['newest:3']);
    } finally { [older, newest, otherBuild, sender].forEach(link => link.destroy()); }
});

it('waits for a newly opened Guide to finish loading before jumping', async () => {
    vi.stubGlobal('addEventListener', () => {}); vi.stubGlobal('removeEventListener', () => {});
    let ready = false; const jumps: number[] = [];
    const reader = new GuideLinks(() => ({ build: 'new', ready }), i => jumps.push(i));
    const sender = new GuideLinks(() => ({ build: null, ready: false }), () => {});
    const timer = setTimeout(() => { ready = true; }, 300);
    try { expect(await sender.navigate('new', 7)).toBe(true); expect(jumps).toEqual([7]); }
    finally { clearTimeout(timer); reader.destroy(); sender.destroy(); }
});

it('contextual links select the current variant instead of the first chapter of that topic',()=>{
 const sections=[{title:'Equipment · Early',text:'Shared notes',context:'gear'},{title:'Equipment · Uber Endgame',text:'Shared notes with formatting differences',context:'gear'}];
 expect(guideSectionIndex(sections,'gear','Shared notes','Uber Endgame')).toBe(1);
 expect(guideSectionIndex(sections,'gear','Unmatched excerpt','Uber Endgame')).toBe(1);
 expect(guideSectionIndex(sections,'gear','Shared notes')).toBe(0);
});

it('offers Export build for any open build and names the guide source in Update guide', () => {
    const guide = { title: 'X', guideImport: { source: 'PoE Vault' } } as unknown as Build;
    expect(panelMenuActions(guide, 'tree', false)).toContain('id="export-build"');
    expect(panelMenuActions(guide, 'tree', false)).toContain('Preview the latest PoE Vault guide');
    expect(panelMenuActions({ ...guide, character: { name: 'C' } } as unknown as Build, 'gear', false)).toContain('Export character');
    expect(panelMenuActions(null, 'tree', false)).not.toContain('export-build');
});
