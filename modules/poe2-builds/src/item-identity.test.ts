import { expect, it } from 'vitest';
import {validate} from './validate.js';
import {itemImage,placeholderImage} from './item-art';
import type {Item} from './model';
const input=(items:unknown[])=>({format:'tavora.build',formatVersion:1,buildId:'identity-test',build:{title:'Test',stages:[{label:'Late',items,skills:[],passives:[]}]}});
it('resolves planner base and unique identifiers instead of displaying variant names or metadata',()=>{
 const items=validate(input([{inventory_id:'BodyArmour1',name:'Late',base:'Metadata/Items/Armours/BodyArmours/FourBodyDexInt2Endgame',mods:[],rarity:'rare'},{inventory_id:'Helm1',name:'Unique Helm',base:'Metadata/Items/Armours/Helmets/FourHelmetDex11',sourceUnique:'FourUniqueHelmetDex11',rarity:'unique',mods:[]}])).stages[0]!.items;
 expect(items[0]!.name).toBe('Sleek Jacket');expect(items[0]!.base).toBe('Sleek Jacket');expect(items[1]!.name).toBe("Alpha's Howl");
 expect(itemImage(items[1]!).actual).toBe(true);
});
it('uses custom placeholders for every armour and jewellery slot',()=>{
 for(const id of ['BodyArmour1','Gloves1','Boots1','Amulet1','Belt1','Charm1'])expect(placeholderImage(id)).toMatch(/^assets\/icons\/gear-/);
});
it('does not use bow art for an unidentified sceptre or generic weapon',()=>{
 const sceptre:Item={inventory_id:'Weapon1',name:'Unknown sceptre',base:'Unknown sceptre',category:'Sceptre',mods:[]};
 expect(itemImage(sceptre).src).toContain('gear-sceptre');
 expect(placeholderImage('Weapon1')).not.toContain('gear-bow');
});

it('uses each weapon set equipment rather than the character class for hand slots',async()=>{
 const {weaponSlotState}=await import('./item-identity.js');
 const item=(id:string,category:string):Item=>({inventory_id:id,name:'Unknown item',category,mods:[]});
 const items=[item('Weapon1','Sceptre'),item('Offhand1','Shield'),item('Weapon2','Crossbow')];
 expect(weaponSlotState(items,1)).toMatchObject({mainLabel:'Sceptre · Main hand',offhandLabel:'Shield · Offhand',blocked:false});
 expect(weaponSlotState(items,2)).toMatchObject({mainLabel:'Crossbow · Main hand',offhandLabel:'Uses both hands',blocked:true});
 expect(weaponSlotState([item('Weapon1','Bow')],1)).toMatchObject({offhandLabel:'Quiver',blocked:false});
 expect(weaponSlotState([item('Weapon1','Staff')],1).blocked).toBe(true);
 expect(weaponSlotState([],2)).toMatchObject({mainLabel:'Main weapon',offhandLabel:'Offhand',blocked:false});
});

it('uses an equipment type when a metadata identity cannot be resolved and preserves source labels',()=>{
 const item=validate(input([{inventory_id:'BodyArmour1',name:'Late',base:'Metadata/Items/UnknownBase',mods:[]}])).stages[0]!.items[0]!;
 expect(item.name).toBe('Body armour');expect(item.base).toBe('');expect(item.sourceBase).toBe('Metadata/Items/UnknownBase');expect(item.sourceLabel).toBe('Late');
});
