import { describe, it, expect } from 'vitest';
import type { TavoraSDK, TavoraDocument, JsonValue } from '@tavora/sdk';
import { validate } from './validate.js';
import { BuildRepository } from './repository';
import { portable, guideSections } from './model';
function fixture() { return { format: 'tavora.build', formatVersion: 1, buildId: '12345678-1234-4234-8234-123456789abc', build: { title: 'Test build', stages: [{ name: 'Early', label: 'Early', passives: [{ id: '123', weapon: 1 }], skills: [{ id: 'ice-shot', name: 'Ice Shot', attributes: ['Dexterity'], supports: [{ id: 'support', name: 'Support', attributes: ['Strength'], isSupport: true }] }], items: [{ inventory_id: 'Weapon1', name: 'Test bow', mods: ['Test modifier'], rarity: 'rare' }] }] }, guideText: { tree: 'Take the nearby nodes.', skills: 'Use the test skill.', items: {}, gems: {}, crafting: {}, sections: [{ title: 'Gameplay', text: 'Complete original user text.\n\nSecond paragraph.', context: 'overview' }] } }; }
function host() {
    const records = new Map<string, TavoraDocument>();
    let fail = false;
    const documents = {
        async list() { return [...records.values()].map(({ data: _, ...s }) => s); },
        async get<T>(id: string) { return (records.get(id) as (Omit<TavoraDocument, 'data'> & {
            data: T;
        }) | undefined) || null; },
        async put(value: {
            id?: string;
            title: string;
            data: JsonValue;
            ifRevision?: number;
        }) { const id = value.id!, old = records.get(id); if (value.ifRevision !== undefined && value.ifRevision !== (old?.revision ?? 0))
            throw Error('CONFLICT'); if (fail && id.startsWith('poe2-build-'))
            throw Error('Disk full'); const doc = { ...value, id, revision: (old?.revision ?? 0) + 1, updatedAt: new Date().toISOString(), bytes: new TextEncoder().encode(JSON.stringify(value.data)).length }; if (doc.bytes > 4 * 1024 * 1024)
            throw Error('QUOTA_EXCEEDED'); records.set(id, doc); const { data: _, ...summary } = doc; return summary; },
        async delete(id: string) { records.delete(id); }, onChange() { return () => { }; }
    } as TavoraSDK['documents'];
    return { documents, records, setFail: () => { fail = true; } };
}
describe('portable build validation', () => {
    it('preserves complete guide sections and support type across export/load', () => { const build = validate(fixture()), loaded = validate(JSON.parse(JSON.stringify(portable(build)))); expect(loaded.guideText?.sections).toEqual(fixture().guideText.sections); expect(loaded.stages[0]?.skills[0]?.supports?.[0]?.attributes).toEqual(['Strength']); });
    it('rejects a future format and invalid allocations', () => { expect(() => validate({ ...fixture(), formatVersion: 999 })).toThrow(/version/); const value = fixture(); value.build.stages[0]!.passives[0]!.weapon = 9; expect(() => validate(value)).toThrow(/passive/); });
    it('retains full text rather than extracting sentences', () => { const value = fixture(); value.guideText.sections[0]!.text = 'Original paragraph. '.repeat(10000); expect(guideSections(validate(value).guideText)[0]?.text).toBe(value.guideText.sections[0]!.text); });
});
it('rejects unsupported bundled tree versions', () => { expect(() => validate({ ...fixture(), build: { ...fixture().build, treeVersion: '0.6' } })).toThrow(/tree version/); });
describe('shared build documents', () => {
    it('stores large Unicode/attachment payloads under the per-document quota', async () => { const h = host(), repo = new BuildRepository(h.documents), build = validate(fixture()); build.guideText!.sections![0]!.text = '🌲 Original guide text. '.repeat(70000); build.guideText!.sections!.push({ ...build.guideText!.sections![0]! }, { ...build.guideText!.sections![0]! }); const id = await repo.put(build); expect((await repo.get(id))?.guideText?.sections).toEqual(build.guideText?.sections); expect((await repo.list()).map(d => d.id)).toEqual([id]); expect([...h.records.values()].every(d => d.bytes < 4 * 1024 * 1024)).toBe(true); });
    it('same file identity replaces one library entry and reclaims prior chunks', async () => { const h = host(), repo = new BuildRepository(h.documents), build = validate(fixture()), id = await repo.put(build); build.title = 'Updated'; expect(await repo.put(build)).toBe(id); expect(await repo.list()).toHaveLength(1); expect((await repo.get(id))?.title).toBe('Updated'); expect(h.records.size).toBe(2); });
    it('failed replacement keeps the previous complete build and cleans new chunks', async () => { const h = host(), repo = new BuildRepository(h.documents), build = validate(fixture()), id = await repo.put(build), before = h.records.size; h.setFail(); build.title = 'Must not replace'; await expect(repo.put(build)).rejects.toThrow('Disk full'); expect((await repo.get(id))?.title).toBe('Test build'); expect(h.records.size).toBe(before); });
    it('concurrent imports never silently overwrite the winning revision', async () => { const h = host(), repo = new BuildRepository(h.documents), build = validate(fixture()); const results = await Promise.allSettled([repo.put(build), repo.put({ ...build, title: 'Other' })]); expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect(results.filter(r => r.status === 'rejected')).toHaveLength(1); expect(await repo.list()).toHaveLength(1); });
    it('missing chunks produce a recovery error instead of a partial build', async () => { const h = host(), repo = new BuildRepository(h.documents), id = await repo.put(validate(fixture())); h.records.delete([...h.records.keys()].find(k => k.startsWith('poe2-data-'))!); await expect(repo.get(id)).rejects.toThrow(/missing/); });
});

it('keeps distinct build-file identities as separate shared library entries', async () => {
 const h=host(),repo=new BuildRepository(h.documents),one=validate(fixture()),two=validate({...fixture(),buildId:'another-build',build:{...fixture().build,title:'Second build'}});
 const first=await repo.put(one),second=await repo.put(two);
 expect(first).not.toBe(second);expect(await repo.list()).toHaveLength(2);
 expect((await repo.get(first))?.title).toBe('Test build');expect((await repo.get(second))?.title).toBe('Second build');
});
it('recovers when a reader holds a superseded header whose old chunks were reclaimed', async () => {
 const h=host(),writer=new BuildRepository(h.documents),original=validate(fixture()),id=await writer.put(original);
 const staleHeader=structuredClone(h.records.get(id)!);
 await writer.put({...original,title:'New complete revision'});
 let firstRead=true;
 const staleDocuments={...h.documents,get:(async(key:string)=>{if(key===id&&firstRead){firstRead=false;return staleHeader}return h.documents.get(key)}) as TavoraSDK['documents']['get']};
 const reader=new BuildRepository(staleDocuments);
 expect((await reader.get(id))?.title).toBe('New complete revision');
});
