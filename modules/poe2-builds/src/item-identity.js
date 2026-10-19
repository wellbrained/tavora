import catalogue from './item-identities.json' with {type:'json'};
const lookup = (table,key) => typeof key === 'string' && Object.hasOwn(table,key) ? table[key] : undefined;
const clean = value => typeof value === 'string' && !/Metadata[\\/]/i.test(value) ? value : '';
const slotTypes = {Helm1:'Helmet',BodyArmour1:'Body armour',Gloves1:'Gloves',Boots1:'Boots',Amulet1:'Amulet',Belt1:'Belt',Ring1:'Ring',Ring2:'Ring',Flask1:'Flask',Flask2:'Mana flask',Charm1:'Charm',Charm2:'Charm',Charm3:'Charm'};
/** Preserve source identifiers and planner labels separately from display identity. */
export function resolveItemIdentity(item) {
 const sourceBase=item.sourceBase || (/^Metadata[\\/]/i.test(item.base||'') ? item.base : '');
 const found=lookup(catalogue.bases,sourceBase);
 const category=found?.[1] || lookup(catalogue.categories,(item.base||'').toLowerCase()) || item.category || lookup(catalogue.categories,(item.name||'').toLowerCase()) || '';
 const base=found?.[0] || clean(item.base);
 const unique=item.rarity==='unique' ? lookup(catalogue.uniques,item.sourceUnique) : '';
 const profile=!!sourceBase && /^(?:Budget|Mid|Late|Early|Unique(?: .*)?|.* target)$/i.test(item.name||'');
 const name=unique || (profile ? base : clean(item.name)) || base || category || slotTypes[item.inventory_id] || (/^Offhand/.test(item.inventory_id)?'Offhand':'Weapon');
 return {...item,name,base,category,...(sourceBase?{sourceBase}:{}),...(profile&&!item.sourceLabel?{sourceLabel:item.name}:{})};
}
export function itemCategory(item) {return item ? resolveItemIdentity(item).category : '';}
export function weaponLabel(item,offhand=false) {
 const type=itemCategory(item);
 return type ? `${type} · ${offhand?'Offhand':'Main hand'}` : offhand?'Offhand':'Main weapon';
}
export function weaponSlotState(items,set) {
 const main=items.find(i=>i.inventory_id==='Weapon'+set),offhand=items.find(i=>i.inventory_id==='Offhand'+set);
 const type=itemCategory(main);
 const twoHanded=['Crossbow','Staff','Warstaff','Two Hand Mace','Two Hand Sword','Two Hand Axe'].includes(type);
 return {main,offhand,mainLabel:weaponLabel(main),offhandLabel:offhand?weaponLabel(offhand,true):type==='Bow'?'Quiver':twoHanded?'Uses both hands':'Offhand',blocked:twoHanded&&!offhand,offhandCategory:offhand?itemCategory(offhand):type==='Bow'?'Quiver':''};
}
