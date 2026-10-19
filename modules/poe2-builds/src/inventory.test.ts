import { readFileSync } from 'node:fs';
import { validate } from './validate.js';
import { portable } from './model';
import { expect, it } from 'vitest';
import { itemForSlot, inventoryMarkup, itemTooltipMarkup, itemTooltipPosition } from './inventory';
import { restoreView } from './view-state';
import type { Item } from './model';
const item=(inventory_id:string,slot_x=0):Item=>({inventory_id,slot_x,name:inventory_id+'-'+slot_x,mods:[]});
it('maps repeated flask/charm records to their exact equipment positions',()=>{
 const items=[item('Flask1'),item('Flask1',1),item('Charm1'),item('Charm1',1),item('Charm1',2)];
 expect(itemForSlot(items,'flask0',1)).toBe(items[0]);expect(itemForSlot(items,'flask1',1)).toBe(items[1]);
 expect(itemForSlot(items,'charm0',1)).toBe(items[2]);expect(itemForSlot(items,'charm1',1)).toBe(items[3]);expect(itemForSlot(items,'charm2',1)).toBe(items[4]);
});
it('also accepts explicitly numbered flask and charm slots',()=>{
 const items=[item('Flask1'),item('Flask2'),item('Charm1'),item('Charm2'),item('Charm3')];
 expect(itemForSlot(items,'flask1',1)).toBe(items[1]);expect(itemForSlot(items,'charm1',1)).toBe(items[3]);expect(itemForSlot(items,'charm2',1)).toBe(items[4]);
});
it('does not fabricate a missing swap weapon or missing equipment',()=>{
 const items=[item('Weapon1'),item('Offhand1'),item('Weapon2')];
 expect(itemForSlot(items,'weapon',2)).toBe(items[2]);expect(itemForSlot(items,'offhand',2)).toBeUndefined();expect(itemForSlot(items,'Helm1',1)).toBeUndefined();
 expect(itemForSlot(items.slice(0,2),'weapon',2)).toBeUndefined();
});
it('restores inventory visibility and equipment weapon independently of tree filter',()=>{
 const previous=restoreView({build:'older',weapon:'2'});expect(previous.inventory).toBe(true);expect(previous.gearWeapon).toBe(1);
 const updated=restoreView({inventory:false,gearWeapon:2,weapon:'all'});expect(restoreView(JSON.parse(JSON.stringify(updated)))).toEqual(updated);
 expect(updated.weapon).toBe('all');expect(updated.inventory).toBe(false);expect(updated.gearWeapon).toBe(2);
 expect(restoreView({gearWeapon:99}).gearWeapon).toBe(1);
});
it('uses one accessible visibility toggle with no backpack content',()=>{
 const shown=inventoryMarkup(true),hidden=inventoryMarkup(false);
 expect(shown).toContain('role="switch" aria-controls="character-inventory" checked');expect(hidden).not.toContain('aria-controls="character-inventory" checked');expect(hidden).toContain('class="character-inventory" hidden');expect(shown.toLowerCase()).not.toContain('backpack');
});

it('keeps notes separated after stats and before the pin hint, without unknown rarity labels',()=>{
 const tooltip=itemTooltipMarkup({...item('Weapon1'),mods:['A stat'],rarity:'rare'},'Main weapon','Exact <note>');
 expect(tooltip).toContain('rarity-rare');expect(tooltip).toContain('Exact &lt;note&gt;');
 expect(tooltip.indexOf('A stat')).toBeLessThan(tooltip.indexOf('inventory-item-notes'));
 expect(tooltip.indexOf('Exact &lt;note&gt;')).toBeLessThan(tooltip.indexOf('inventory-tooltip-hint'));
 const unknown=itemTooltipMarkup(item('Weapon1'),'Main weapon');
 expect(unknown).not.toContain('Rarity not provided');expect(unknown).not.toContain('rarity-badge');expect(unknown).not.toContain('inventory-item-notes');
});
it('persists both gear visibility controls and node labels independently',()=>{
 const view=restoreView({inventory:true,equipmentList:false,nodeNames:false,decorativeFrames:true});
 expect(restoreView(JSON.parse(JSON.stringify(view)))).toEqual(view);
 expect(restoreView({})).toMatchObject({equipmentList:true,nodeNames:true});
 expect(inventoryMarkup(true,false)).not.toContain('aria-controls="equipment-list" checked');
 expect(inventoryMarkup(true,false)).toContain('aria-controls="equipment-list"');
});

it.skipIf(!process.env.POE2_NOTES_FILE || !process.env.POE2_REPAIRED_FILE)('round-trips authentic item notes without changing planner data or corrected guide chapters',()=>{
 const noteBuild=validate(JSON.parse(readFileSync(process.env.POE2_NOTES_FILE!,'utf8')));
 const original=validate(JSON.parse(readFileSync(process.env.POE2_REPAIRED_FILE!,'utf8')));
 const restored=validate(JSON.parse(JSON.stringify(portable(noteBuild))));
 expect(restored.fileId).toBe(original.fileId);expect(restored.stages).toEqual(original.stages);
 expect(restored.guideText!.sections).toEqual(original.guideText!.sections);
 expect(restored.guideText!.stageNotes).toEqual(original.guideText!.stageNotes);
 expect(Object.keys(restored.guideText!.items!)).toHaveLength(10);
 expect(restored.guideText!.items!.Amulet1).toBe('You need at least 30 spirit on the amulet to use all spirit gems.');
});

it('anchors hover details below the pointer instead of the equipment-slot edge',()=>{
 expect(itemTooltipPosition({clientX:120,clientY:200},520,400,800,1000)).toEqual({left:132,top:216});
 expect(itemTooltipPosition({clientX:140,clientY:240},520,400,800,1000)).toEqual({left:152,top:256});
});
it('flips above near the bottom and clamps to narrow panel gutters',()=>{
 expect(itemTooltipPosition({clientX:700,clientY:900},520,400,800,1000)).toEqual({left:272,top:484});
 expect(itemTooltipPosition({clientX:200,clientY:300},382,538,398,606)).toEqual({left:8,top:8});
});
