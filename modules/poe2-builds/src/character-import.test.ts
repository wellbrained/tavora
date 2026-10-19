import { readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { decodePob, parsePob, MAX_XML_BYTES } from './pob-import';
import { characterProfileIndices, importNinja, ninjaAddress, ninjaItem, prepareCharacterSave } from './character-import';
import { portable } from './model';
import { validate } from './validate.js';

const item=(id:number,name:string)=>`<Item id="${id}">Rarity: RARE
${name}
Soaring Spear
Item Level: 82
Quality: 20
LevelReq: 70
Implicits: 1
{rune}6% increased Attack Speed
Adds 10 to 22 Physical Damage
</Item>`;
const xml=`<PathOfBuilding2><Build className="Mercenary" ascendClassName="Gemling Legionnaire" level="90"/>
<Items activeItemSet="2">${item(1,'First weapon')}${item(2,'Active weapon')}
<ItemSet id="1" title="Early"><Slot name="Weapon 1" itemId="1"/></ItemSet>
<ItemSet id="2" title="Bossing" useSecondWeaponSet="true"><Slot name="Weapon 1" itemId="2"/><Slot name="Charm 2" itemId="1"/><Slot name="Flask 2" itemId="1"/></ItemSet></Items>
<Skills activeSkillSet="2"><SkillSet id="1" title="Early gems"><Skill><Gem gemId="Metadata/Items/Gems/SkillGemIceNova" nameSpec="Ice Nova" level="10" quality="5"/></Skill></SkillSet>
<SkillSet id="2" title="Endgame gems"><Skill><Gem gemId="Metadata/Items/Gem/SkillGemPlayerDefaultSpearThrow" nameSpec="Spear Throw" level="20" quality="20"/><Gem gemId="Metadata/Items/Gems/SupportGemFrostNexus" nameSpec="Frost Nexus" level="1" quality="0"/></Skill></SkillSet></Skills>
<Tree activeSpec="2"><Spec title="Early tree" treeVersion="0_4" nodes="1,2"/><Spec title="Endgame tree" treeVersion="0_5" ascendancyInternalId="Mercenary3" nodes="3,4,5"><WeaponSet1 nodes="4"/><WeaponSet2 nodes="5"/></Spec></Tree></PathOfBuilding2>`;

it('decodes compressed PoB exports and reads all three independent active profiles',async()=>{
 const code=deflateSync(xml).toString('base64url');
 const parsed=parsePob(await decodePob(code),'My character');
 const b=parsed.build,s=b.stages[0]!;
 expect(b.character).toMatchObject({name:'My character',class:'Mercenary',level:90,source:'PoB'});
 expect(s.items[0]!.name).toBe('Active weapon');
 expect(s.weaponSet).toBe(2);
 expect(s.skills[0]).toMatchObject({name:'Spear Throw',level:20,quality:20});
 expect(s.skills[0]!.supports?.[0]).toMatchObject({name:'Frost Nexus',isSupport:true,level:1});
 expect(s.passives).toEqual([{id:'3',weapon:0},{id:'4',weapon:1},{id:'5',weapon:2}]);
 expect(b.treeVersion).toBe('0.5');
 expect(b.ascendancy).toBe('Gemling Legionnaire');
 expect(b.characterExport).toBe(xml);
 expect(validate(portable(b))).toEqual(b);
});

it('preserves independent alternative profiles without merging equipment or gems',()=>{
 const b=parsePob(xml).build;
 expect(b.stages).toHaveLength(4);
 const gear=characterProfileIndices(b,'gear'),skills=characterProfileIndices(b,'skills'),trees=characterProfileIndices(b,'tree');
 expect(gear).toEqual([0,1]);expect(skills).toEqual([0,2]);expect(trees).toEqual([0,3]);
 expect(b.stages[gear[1]!]!.items.map(i=>i.name)).toEqual(['First weapon']);
 expect(b.stages[skills[1]!]!.skills.map(g=>g.name)).toEqual(['Ice Nova']);
 expect(b.stages[trees[1]!]!.treeVersion).toBe('0.4');
 expect(b.stages[trees[1]!]!.passives.every(n=>n.weapon===0)).toBe(true);
});

it('keeps numbered charms/flasks, quality, requirements and rune sections',()=>{
 const i=parsePob(xml).build.stages[0]!.items;
 expect(i.map(x=>x.inventory_id)).toEqual(['Weapon1','Charm2','Flask2']);
 expect(i[0]).toMatchObject({itemLevel:82,quality:20,level:70});
 expect(i[0]!.sourceSections).toEqual([{kind:'runeMods',mods:['6% increased Attack Speed']},{kind:'explicitMods',mods:['Adds 10 to 22 Physical Damage']}]);
});

it.each([
 ['PoE 1',xml.replaceAll('PathOfBuilding2','PathOfBuilding')],
 ['doctype','<!DOCTYPE PathOfBuilding2 [<!ENTITY x SYSTEM "file:///private">]>'+xml],
 ['malformed',xml.replace('</Items>','')],
 ['unsupported tree',xml.replace('0_4','0_3')],
 ['missing equipped item',xml.replace('itemId="2"','itemId="999"')],
 ['bad active set',xml.replace('activeItemSet="2"','activeItemSet="7"')],
 ['invalid passive',xml.replace('nodes="1,2"','nodes="wrong"')],
])('rejects %s instead of saving a partial character',(_label,input)=>expect(()=>parsePob(input)).toThrow());

it('bounds expanded export size',async()=>{
 const code=deflateSync(' '.repeat(MAX_XML_BYTES+1)).toString('base64url');
 await expect(decodePob(code)).rejects.toThrow('8 MB');
 await expect(decodePob('https://pobb.in/something')).rejects.toThrow('export code');
});

it('accepts only the exact poe.ninja PoE2 character source and canonicalizes filters',()=>{
 expect(ninjaAddress('https://poe.ninja/poe2/builds/league/character/account/My%20Character?i=1').name).toBe('My Character');
 for(const url of ['https://poe.ninja.evil/poe2/builds/a/character/b/c','https://user@poe.ninja/poe2/builds/a/character/b/c','http://poe.ninja/poe2/builds/a/character/b/c','https://poe.ninja/poe2/builds'])expect(()=>ninjaAddress(url)).toThrow();
});

it('preserves exact source item identities, property values and raw modifier IDs',()=>{
 const fallback=parsePob(xml).build.stages[0]!.items[0]!;
 const item=ninjaItem({name:'Exact name',baseType:'Soaring Spear',rarity:'Rare',ilvl:82,properties:[{name:'Physical Damage',values:[['54-104',0]]}],requirements:[{name:'Level',values:[['70',0]]}],explicitMods:['Adds 10 to 22 [Physical|Physical] Damage'],runeMods:['6% increased [Attack] Speed'],mods:{explicit:[{id:'LocalAddedPhysicalDamage5',stats:{local_minimum_added_physical_damage:10}}]}},fallback);
 expect(item.name).toBe('Exact name');expect(item.mods).toEqual(['Adds 10 to 22 Physical Damage','6% increased Attack Speed']);
 expect(item.sourceModifiers?.[0]?.id).toBe('LocalAddedPhysicalDamage5');
 expect(item.properties?.[0]?.values[0]?.[0]).toBe('54-104');
});

it('imports a character through the SDK network seam and keeps refresh identity explicit',async()=>{
 const calls:string[]=[];
 const build=await importNinja('https://poe.ninja/poe2/builds/test/character/player/Tester',{fetch:async url=>{
  calls.push(url);return {status:200,url,headers:{},body:JSON.stringify(calls.length===1?{snapshotVersions:[{url:'test',version:'v1',snapshotName:'Test League'}]}:{account:'player',name:'Tester',baseClass:'Mercenary',level:95,pathOfBuildingExport:deflateSync(xml).toString('base64url'),questStats:['+5% to all [Resistances]']})};
 }});
 expect(calls).toHaveLength(2);expect(new URL(calls[1]!).searchParams.get('name')).toBe('Tester');
 expect(build.build.character).toMatchObject({source:'poe.ninja',name:'Tester',level:95});
 expect(build.build.questStats).toEqual(['+5% to all Resistances']);
 const saved=prepareCharacterSave(build.build,'Character alias',null),update=prepareCharacterSave(parsePob(xml).build,'Updated',saved);
 expect(update.fileId).toBe(saved.fileId);expect(update.character!.name).toBe('Updated');
 expect(()=>prepareCharacterSave(build.build,'Tester',{...saved,character:undefined} as never)).toThrow('guide');
 expect(()=>prepareCharacterSave(build.build,'',null)).toThrow('name');
});

it('reports unavailable sources without replacing saved data',async()=>{
 await expect(importNinja('https://poe.ninja/poe2/builds/test/character/player/Tester',{fetch:async url=>({status:403,url,headers:{},body:''})})).rejects.toThrow('403');
});

it.runIf(!!process.env.POE2_CHARACTER_SMOKE_XML)('reads a real local PoB export without committing personal fixtures',async()=>{
 const build=parsePob(await readFile(process.env.POE2_CHARACTER_SMOKE_XML!,'utf8'),'Local test').build;
 expect(build.stages[0]!.items.length).toBeGreaterThan(10);
 expect(build.stages[0]!.skills.some(g=>g.level)).toBe(true);
 expect(validate(portable(build))).toEqual(build);
});
