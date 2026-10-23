import {afterEach,expect,it} from 'vitest';
import {affixRows,TIER_DATA_VERSION} from './affix-tiers';
import {itemDetails} from './item-details';
import {noteText,setLanguage} from './i18n';
import type {AffixRow,Item} from './model';

afterEach(()=>setLanguage('en'));
const rare=(base:string,explicit:string[],extra:Partial<Item>={}):Item=>({inventory_id:'Weapon1',name:'Test',base,rarity:'rare',mods:explicit,sourceSections:[{kind:'explicitMods',mods:explicit}],...extra});
const ninja=(kind:string,...ids:string[])=>ids.map(id=>({kind,id,stats:{}}));
const moba=(kind:'prefix'|'suffix',...ids:string[])=>ids.map(id=>({kind,id,stats:{}}));
const short=(rows:AffixRow[])=>rows.map(r=>(r.contributors||[r]).map(c=>`${c.type}${c.tier??''}/${c.tiers??''}${c.hybrid?' '+c.hybrid:''}`).join('+'));

it('ranks tiers per base the way PoB does, with tier 1 the best',()=>{
 expect(TIER_DATA_VERSION).toBe('0.23.1');
 const spear=rare('Soaring Spear',['Adds 10 to 22 Physical Damage','27% increased Attack Speed'],{sourceModifiers:ninja('explicit','LocalAddedPhysicalDamage5','LocalIncreasedAttackSpeed8')});
 expect(affixRows(spear).map(r=>[r.type,r.tier,r.tiers,r.name])).toEqual([['P',5,9,'Gleaming'],['S',1,8,'of Celebration']]);
 expect(short(affixRows(rare('Unset Ring',['+110 to maximum Life','+28% to Lightning Resistance'],{sourceModifiers:ninja('explicit','IncreasedLife8','LightningResist5')})))).toEqual(['P1/8','S4/8']);
 expect(short(affixRows(rare('Stellar Amulet',['+30 to Spirit'],{sourceModifiers:moba('prefix','IncreasedSpirit1')})))).toEqual(['P5/5']);
 expect(short(affixRows(rare('Ultimate Mana Flask',['76% increased Amount Recovered'],{rarity:'magic',sourceModifiers:moba('prefix','FlaskIncreasedRecoveryAmount8')})))).toEqual(['P1/8']);
});

it('reads poe.ninja IDs per section and Mobalytics prefix/suffix slugs',()=>{
 const sections=[{kind:'explicitMods',mods:['62% increased Evasion and Energy Shield']},{kind:'craftedMods',mods:['+28% to Lightning Resistance']}];
 const fromNinja=affixRows(rare('Daggerfoot Shoes',[],{sourceSections:sections,sourceModifiers:[...ninja('explicit','LocalIncreasedEvasionAndEnergyShield4'),...ninja('crafted','LightningResist5')]}));
 expect(fromNinja.map(r=>[r.kind,r.type,r.tier,r.name])).toEqual([['explicitMods','P',4,'Ephemeral'],['craftedMods','S',4,'of the Tempest']]);
 const fromMoba=affixRows(rare('Daggerfoot Shoes',[],{sourceSections:sections,sourceModifiers:[...moba('prefix','LocalIncreasedEvasionAndEnergyShield4'),...moba('suffix','LightningResist5')]}));
 expect(short(fromMoba)).toEqual(['P4/7','S4/8']);
});

it('reads the Prefix:/Suffix: lines of an item crafted in PoB',()=>{
 const item=rare('Soaring Spear',['Adds 10 to 22 Physical Damage'],{sourceText:'Rarity: RARE\nTest\nSoaring Spear\nPrefix: {range:0.5}LocalAddedPhysicalDamage5\nPrefix: None\nSuffix: None\nAdds 10 to 22 Physical Damage'});
 expect(short(affixRows(item))).toEqual(['P5/9']);
});

it('keeps the type but drops the tier when an ID is unknown or its value is from another patch',()=>{
 expect(affixRows(rare('Soaring Spear',['Adds 10 to 22 Physical Damage'],{sourceModifiers:ninja('explicit','NoSuchMod1')}))).toEqual([]);
 expect(short(affixRows(rare('Soaring Spear',['Adds 40 to 90 Physical Damage'],{sourceModifiers:ninja('explicit','LocalAddedPhysicalDamage5')})))).toEqual(['P/']);
 // A jewel mod named on an amulet can't be there.
 expect(short(affixRows(rare('Stellar Amulet',['+30 to Spirit','12% increased maximum Energy Shield'],{sourceModifiers:moba('prefix','IncreasedSpirit1','JewelEnergyShield')})))).toEqual(['P5/5']);
});

it('works out text-only items only when exactly one mod fits wording and value',()=>{
 const pob={sourceText:'Rarity: RARE\nTest\nUnset Ring\n+28% to Lightning Resistance'};
 expect(short(affixRows(rare('Unset Ring',['+28% to Lightning Resistance'],pob)))).toEqual(['S4/8']);
 // Catalyst quality could have lifted a lower tier to 28%.
 expect(short(affixRows(rare('Unset Ring',['+28% to Lightning Resistance'],{...pob,quality:20})))).toEqual(['S/']);
 // Several projectile-level mods fit a two-handed weapon's hand wraps: the type is known, the tier isn't.
 expect(short(affixRows(rare('Runeforged Secured Wraps',['+2 to Level of all Projectile Skills'])))).toEqual(['S/']);
 // No ring rolls this much life.
 expect(affixRows(rare('Unset Ring',['+150 to maximum Life']))).toEqual([]);
 expect(affixRows(rare('Unset Ring',['+28% to Lightning Resistance'],{rarity:'unique'}))).toEqual([]);
});

it('keeps hybrid affixes and lines two affixes add up to',()=>{
 const hybrid=affixRows(rare('Daggerfoot Shoes',['+78 to Evasion Rating','+25 to maximum Energy Shield']));
 expect(short(hybrid)).toEqual(['P1/4 start','P1/4 end']);
 expect(hybrid[0]!.name).toBe("Cherub's");
 const rarity=affixRows(rare('Unset Ring',['35% increased Rarity of Items found'],{sourceModifiers:ninja('explicit','ItemFoundRarityIncreasePrefix3','ItemFoundRarityIncrease3')}));
 expect(short(rarity)).toEqual(['P1/3+S1/3']);
});

it('falls back to the hand-checked rows for old saved builds without IDs',()=>{
 const old=rare('Soaring Spear',['Adds 10 to 22 Physical Damage','Leeches 8.66% of Physical Damage as Mana'],{affixRows:[{text:'Adds 10 to 22 Physical Damage',type:'P',id:'LocalAddedPhysicalDamage5',tier:5,name:'Gleaming'},{text:'Leeches 8.66% of Physical Damage as Mana',type:'S',id:'old',tier:1}]});
 expect(short(affixRows(old))).toEqual(['P5/9','S1/']);
});

it('shows badges with a hover in the language picked',()=>{
 const spear=rare('Soaring Spear',['Adds 10 to 22 Physical Damage','+2 to Level of all Projectile Skills'],{sourceModifiers:ninja('explicit','LocalAddedPhysicalDamage5')});
 const wraps=rare('Runeforged Secured Wraps',['+2 to Level of all Projectile Skills']);
 expect(itemDetails(spear)).toContain('<abbr title="Prefix · Tier 5 of 9 · Gleaming">[P5]</abbr>');
 expect(itemDetails(wraps)).toContain('<abbr title="Suffix · Tier not given">[S]</abbr>');
 setLanguage('de');
 expect(itemDetails(spear)).toContain('<abbr title="Präfix · Tier 5 von 9 · Gleaming">[P5]</abbr>');
 expect(itemDetails(wraps)).toContain('<abbr title="Suffix · Tier nicht angegeben">[S]</abbr>');
});

it('shows older tier notes from saved builds with the new wording',()=>{
 expect(noteText('Unresolved affix tiers and item properties are left blank.')).toBe("Affix tiers show only where they're certain. Missing item properties stay blank.");
 setLanguage('de');
 expect(noteText("Uniques without exact rolls use labelled PoB reference ranges. Affix tiers the guide doesn't give are left out, never guessed.")).toMatch(/nur da, wo sie sicher sind/);
});
