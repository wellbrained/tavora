import { readFileSync } from 'node:fs';
import { deflateSync, gunzipSync } from 'node:zlib';
import { afterEach, expect, it } from 'vitest';
import { guideJewel } from './guide-jewels';
import { parseMobalytics } from './mobalytics-import';
import { parsePob } from './pob-import';
import { characterProfileIndices, importNinja } from './character-import';
import { itemDetails, itemTooltipContent } from './item-details';
import { gearCard } from './presentation';
import { portable } from './model';
import { validate } from './validate.js';
import { setLanguage } from './i18n';

afterEach(() => setLanguage('en'));

const iceShot = () => { const f = JSON.parse(gunzipSync(readFileSync(new URL('../test/fixtures/mobalytics/ice-shot-deadeye.json.gz', import.meta.url))).toString('utf8')); return parseMobalytics(f.document, f.url); };

it('reads each Mobalytics variant\'s tree jewels into that variant', () => {
 const b = iceShot();
 expect(b.stages.map(s => s.jewels?.length ?? 0)).toEqual([0, 0, 0, 2, 2, 8]);
 const jewels = b.stages[5]!.jewels!;
 expect(jewels.map(j => j.slot_x)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
 expect(jewels.every(j => j.inventory_id === 'Jewel' && /^\d+$/.test(j.node!))).toBe(true);
 // A rare jewel's mods come from its game mod IDs, as PoB ranges, never as rolls.
 expect(jewels[0]).toMatchObject({ name: 'Emerald', node: '62152', reference: true, mods: ['(5-15)% increased Attack Damage', '(25-29)% increased Critical Hit Chance for Attacks', '(30-34)% increased Critical Damage Bonus for Attack Damage', '(2-4)% increased Attack Speed with Bows'] });
 expect(jewels[0]!.modsMissing).toBeUndefined();
 expect(jewels[0]!.sourceModifiers?.map(m => m.kind + ':' + m.id)).toEqual(['prefix:JewelAttackDamage', 'suffix:AttackCriticalStrikeChance4', 'suffix:AttackCriticalStrikeMultiplier5', 'suffix:JewelBowSpeed']);
 // Heart of the Well's mods are picked from a pool, so PoB has no reference and the guide gives none.
 expect(jewels.find(j => j.name === 'Heart of the Well')).toMatchObject({ rarity: 'unique', mods: [], modsMissing: true });
 expect(b.importNotes!.join('\n')).not.toMatch(/Jewels in/);
});

it('gives a guide unique PoB\'s reference ranges, marked as reference', () => {
 const jewel = guideJewel({ isUnique: true, jewelSlug: 'jewel-the-adorned', nodeSlug: 'node-61834', prefixSlugs: ['', ''], suffixSlugs: null }, 0)!;
 expect(jewel).toMatchObject({ name: 'The Adorned', base: 'Diamond', rarity: 'unique', reference: true, node: '61834', mods: ['(0-150)% increased Effect of Jewel Socket Passive Skills', 'containing Corrupted Magic Jewels'] });
 expect(jewel.modsMissing).toBeUndefined();
 // The trade search names the unique when the slug alone would read wrong.
 const named = guideJewel({ isUnique: true, jewelSlug: 'jewel-fouruniquejewel99-grand-spectrum', poe2TradeRequest: { query: JSON.stringify({ query: { name: 'Grand Spectrum' } }) } }, 0)!;
 expect(named).toMatchObject({ name: 'Grand Spectrum', reference: true });
 // PoB's "Corrupted" line marks the item instead of becoming a mod.
 const voices = guideJewel({ isUnique: true, jewelSlug: 'jewel-voices' }, 0)!;
 expect(voices).toMatchObject({ name: 'Voices', corrupted: true, mods: [], modsMissing: true });
});

it('shows the mods a guide jewel\'s slugs resolve to and says the guide doesn\'t give the rest', () => {
 const partial = guideJewel({ isUnique: false, jewelSlug: 'jewel-jewelstr', prefixSlugs: ['JewelAttackDamage', 'SomethingMobalyticsMadeUp'], suffixSlugs: [] }, 0)!;
 expect(partial).toMatchObject({ name: 'Ruby', mods: ['(5-15)% increased Attack Damage'], modsMissing: true, reference: true });
 const none = guideJewel({ isUnique: false, jewelSlug: 'jewel-jewelradiusint', prefixSlugs: [], suffixSlugs: [] }, 0)!;
 expect(none).toMatchObject({ name: 'Time-Lost Sapphire', mods: [], modsMissing: true });
 expect(none.reference).toBeUndefined();
 expect(itemDetails(none)).toContain('The guide doesn&#39;t give its mods.');
 expect(itemDetails(partial)).toContain('The guide doesn&#39;t give its other mods.');
 const rows = itemTooltipContent(partial).sections!.flatMap(s => s.rows.map(r => r.text));
 expect(rows).toContain('The guide doesn\'t give its other mods.');
 expect(rows).toContain('PoB reference · exact rolls not exported');
 setLanguage('de');
 expect(itemDetails(none)).toContain('Der Guide nennt seine Mods nicht.');
 expect(gearCard(validate(portable({ ...iceShot(), stages: [{ ...iceShot().stages[5]!, items: [] }] })).stages[0]!.jewels![1]!, '')).toContain('Jewel 2');
});

const jewel = (id: number, name: string, uid: string) => `<Item id="${id}">Rarity: RARE
${name}
Emerald
Unique ID: ${uid}
Item Level: 81
Limited to: 2
Implicits: 0
12% increased Attack Damage
</Item>`;
const xml = `<PathOfBuilding2><Build className="Ranger" ascendClassName="Deadeye" level="90"/>
<Items activeItemSet="1">${jewel(1, 'Phoenix Wound', 'uid-one')}${jewel(2, 'Rapture Joy', 'uid-two')}${jewel(3, 'Early Spark', 'uid-three')}
<ItemSet id="1" title="Main"></ItemSet><ItemSet id="2" title="Swap"></ItemSet></Items>
<Skills><Skill><Gem gemId="Metadata/Items/Gems/SkillGemIceShot" nameSpec="Ice Shot" level="20"/></Skill></Skills>
<Tree activeSpec="2"><Spec title="Early" treeVersion="0_5" nodes="1"><Sockets><Socket nodeId="21984" itemId="3"/></Sockets></Spec>
<Spec title="Endgame" treeVersion="0_5" nodes="2"><Sockets><Socket nodeId="60735" itemId="1"/><Socket nodeId="61834" itemId="0"/><Socket nodeId="32763" itemId="999"/><Socket nodeId="26178" itemId="2"/></Sockets></Spec></Tree></PathOfBuilding2>`;

it('reads PoB\'s socketed jewels per tree and gives every variant the jewels of its tree', () => {
 const { build, warnings } = parsePob(xml, 'Archer');
 expect(warnings.join('\n')).not.toMatch(/jewel/i);
 // Empty sockets and sockets naming a missing item are skipped.
 expect(build.stages[0]!.jewels!.map(j => [j.name, j.node, j.slot_x])).toEqual([['Phoenix Wound', '60735', 0], ['Rapture Joy', '26178', 1]]);
 expect(build.stages[0]!.jewels![0]).toMatchObject({ itemLevel: 81, mods: ['12% increased Attack Damage'], exact: true });
 // Gear shows the active tree's jewels, also for another equipment set.
 const gear = characterProfileIndices(build, 'gear'), trees = characterProfileIndices(build, 'tree');
 expect(build.stages[gear[1]!]!.jewels!.map(j => j.name)).toEqual(['Phoenix Wound', 'Rapture Joy']);
 expect(build.stages[trees[1]!]!.jewels!.map(j => j.name)).toEqual(['Early Spark']);
});

it('uses poe.ninja\'s own copy of each socketed jewel', async () => {
 const ninja = { id: 'uid-one', name: 'Phoenix Wound', baseType: 'Emerald', rarity: 'Rare', ilvl: 81, explicitMods: ['14% increased [Attack] Damage', '7% increased [CriticalDamageBonus|Critical Damage Bonus]'], mods: { explicit: [{ id: 'JewelAttackDamage', stats: { attack_damage_: 14 } }] } };
 let calls = 0;
 const result = await importNinja('https://poe.ninja/poe2/builds/test/character/player/Archer', { fetch: async url => ({ status: 200, url, headers: {}, body: JSON.stringify(++calls === 1 ? { snapshotVersions: [{ url: 'test', version: 'v1', snapshotName: 'Test' }] } : { account: 'player', name: 'Archer', level: 90, pathOfBuildingExport: deflateSync(xml).toString('base64url'), jewels: [{ itemData: ninja }] }) }) });
 const jewels = result.build.stages[0]!.jewels!;
 expect(jewels[0]).toMatchObject({ name: 'Phoenix Wound', node: '60735', inventory_id: 'Jewel', mods: ['14% increased Attack Damage', '7% increased Critical Damage Bonus'] });
 expect(jewels[0]!.sourceModifiers?.[0]?.id).toBe('JewelAttackDamage');
 // A jewel poe.ninja doesn't list keeps the PoB export's text.
 expect(jewels[1]).toMatchObject({ name: 'Rapture Joy', mods: ['12% increased Attack Damage'] });
});

it('round-trips jewels through Export build and Load build file', () => {
 for (const build of [iceShot(), parsePob(xml).build]) {
  const file = JSON.stringify(portable(build), null, 2);
  expect(validate(JSON.parse(file))).toEqual(build);
 }
});

it('still loads files saved before jewels', () => {
 const old = validate({ format: 'tavora.build', formatVersion: 1, buildId: 'old-file', build: { title: 'Old', stages: [{ name: 'Early', passives: [], skills: [], items: [{ inventory_id: 'Helm1', name: 'Hat', mods: [] }] }] } });
 expect(old.stages[0]!.jewels).toBeUndefined();
 expect(old.stages[0]!.items[0]!.node).toBeUndefined();
 expect(() => validate({ ...portable(old), build: { ...old, stages: [{ ...old.stages[0]!, jewels: [{ inventory_id: 'Jewel', name: 'Bad', mods: [], node: '<script>' }] }] } })).not.toThrow();
 const cleaned = validate({ ...portable(old), build: { ...old, stages: [{ ...old.stages[0]!, jewels: [{ inventory_id: 'Jewel', name: 'Bad', mods: [], node: '<script>' }] }] } });
 expect(cleaned.stages[0]!.jewels![0]!.node).toBeUndefined();
});
