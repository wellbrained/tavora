import {expect,it} from 'vitest';
import {validate} from './validate.js';
import {portable,type Item} from './model';
import {itemDetails,equipmentOrder} from './item-details';
import {itemSignature,enrichItem,buildDisplayTitle} from './item-data.js';
import {readerChapters} from './guide-chapters';
const item:Item={inventory_id:'Weapon1',name:'Example spear',base:'Soaring Spear',mods:['Suffix','Hybrid accuracy','Hybrid speed','Socket'],rarity:'rare',itemLevel:82,quality:20,requirements:[{name:'Level',values:[['70',0]]}],sourceSections:[{kind:'explicitMods',mods:['Suffix']},{kind:'craftedMods',mods:['Hybrid accuracy','Hybrid speed']},{kind:'runeMods',mods:['Socket']}],affixRows:[{text:'Suffix',type:'S',id:'s',tier:2},{text:'Hybrid accuracy',type:'P',id:'p',tier:1,status:'Crafted',hybrid:'start'},{text:'Hybrid speed',type:'P',id:'p',tier:1,status:'Crafted',hybrid:'end'}]};
const document=(items:unknown[])=>({format:'tavora.build',formatVersion:1,buildId:'affix-test',build:{title:'Example',stages:[{label:'Early',items,skills:[],passives:[]}]}});
it('retains metadata, tiers, hybrid identity, requirements and quest choices through portable save/load',()=>{
 const input={...document([item]),build:{...document([]).build,questSelections:[{quest:'Choice',act:'Act 2',area:'Area',reward:'Exact reward'}],stages:[{...document([item]).build.stages[0],questRecommendations:[{text:'Original author advice'}]}]}};
 const loaded=validate(JSON.parse(JSON.stringify(portable(validate(input)))));
 expect(loaded.stages[0]!.items[0]!.affixRows?.map(a=>[a.type,a.tier,a.id])).toEqual([['S',2,'s'],['P',1,'p'],['P',1,'p']]);
 expect(loaded.stages[0]!.items[0]!.requirements?.[0]?.values[0]?.[0]).toBe('70');
 expect(loaded.questSelections?.[0]?.reward).toBe('Exact reward');
 expect(readerChapters(loaded).some(c=>c.title==='Quest rewards')).toBe(true);
 expect(readerChapters(loaded).some(c=>c.title==='Quest rewards · Early'&&c.text==='Original author advice')).toBe(true);
});
it('puts prefix rows first, keeps statuses and hybrid relationships, and leaves socketed effects last without headings',()=>{
 const markup=itemDetails(item);
 expect(markup.indexOf('Hybrid accuracy')).toBeLessThan(markup.indexOf('Suffix'));
 expect(markup.indexOf('Hybrid speed')).toBeLessThan(markup.indexOf('Suffix'));
 expect(markup.indexOf('Socketed effects')).toBeGreaterThan(markup.indexOf('Suffix'));
 expect(markup).toContain('[P1]');expect(markup).toContain('[S2]');expect(markup).toContain('Crafted');
 expect(markup).toContain('hybrid-start');expect(markup).toContain('hybrid-end');
 expect(markup).not.toContain('>Prefixes<');expect(markup).not.toContain('>Suffixes<');
 expect(itemDetails({...item,affixRows:[{text:'Suffix',type:'S',id:'unknown'}]})).toContain('[S]');
});
it('retains both contributors when one displayed value combines a prefix and suffix',()=>{
 const combined={...item,mods:['Combined rarity'],sourceSections:[],affixRows:[{text:'Combined rarity',type:'P' as const,id:'p',contributors:[{text:'Combined rarity',type:'P' as const,id:'p',tier:1},{text:'Combined rarity',type:'S' as const,id:'s',tier:3}]}]};
 expect(itemDetails(combined)).toContain('[P1]');expect(itemDetails(combined)).toContain('[S3]');
 expect(itemDetails({...combined,rarity:'unique'})).not.toContain('[P1]');
});
it('bounds imported metadata and escapes source text in every new item field',()=>{
 const loaded=validate(document([{...item,name:'<script>x</script>',affixRows:[{text:'Suffix',type:'S',id:'s',tier:999},{text:'Hybrid accuracy',type:'P',id:'p',tier:1,name:'" onmouseover="x'}],properties:[{name:'<img>',values:[['<value>',0]]}]}])).stages[0]!.items[0]!;
 expect(loaded.affixRows?.[0]?.tier).toBeUndefined();
 const markup=itemDetails(loaded);expect(markup).not.toContain('<script>');expect(markup).not.toContain('<img>');expect(markup).toContain('&lt;value&gt;');expect(markup).not.toContain('" onmouseover="');
});
it('does not apply catalogue facts to unrelated or edited item content',()=>{
 expect(enrichItem(item)).toEqual(item);expect(itemSignature(item)).not.toBe(itemSignature({...item,mods:['changed']}));
 expect(buildDisplayTitle('Maxroll · Example')).toBe('Example · Maxroll');expect(buildDisplayTitle('Example · Maxroll')).toBe('Example · Maxroll');
});
it('uses a deterministic equipment order independent of import order',()=>{
 const ids=['Flask2','Ring2','Belt1','Offhand1','Boots1','Weapon2','Amulet1','Weapon1','Ring1','Gloves1','Helm1','BodyArmour1','Charm3','Charm1','Charm2','Flask1'];
 expect(ids.map(inventory_id=>({...item,inventory_id})).sort((a,b)=>equipmentOrder(a)-equipmentOrder(b)).map(i=>i.inventory_id)).toEqual(['Weapon1','Weapon2','Offhand1','Helm1','BodyArmour1','Gloves1','Boots1','Belt1','Amulet1','Ring1','Ring2','Charm1','Charm2','Charm3','Flask1','Flask2']);
});
