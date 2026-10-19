import {itemMetadata} from './item-metadata.js';
import catalogue from './item-details.json' with {type:'json'};

const text=v=>typeof v==='string'?v:'';
export function itemSignature(item) {
 const stats=Object.entries(item.sourceStats||{}).sort(([a],[b])=>a<b?-1:a>b?1:0);
 return JSON.stringify([item.inventory_id,item.slot_x||0,item.name,item.base||'',item.mods,stats]);
}
/** Full signatures are compared: a hash collision cannot apply another item's facts. */
export function enrichItem(item) {
 const signature=itemSignature(item),data=catalogue[signature];
 if(!data)return item;
 const saved=Object.fromEntries(['sourceSections','properties','requirements','affixRows','itemLevel','corrupted','dps'].filter(k=>item[k]!==undefined).map(k=>[k,item[k]]));
 return {...item,mods:structuredClone(data.mods),...itemMetadata(data),...saved};
}
export function buildDisplayTitle(value) {
 const title=text(value),match=/^(Mobalytics|Maxroll|poe\.ninja|PoE Ninja|PoE Vault)\s*[·|]\s*(.+)$/i.exec(title);
 if(!match)return title;
 const name=match[2]==='ResurrectForbidden'?'Resurrect Forbidden':match[2];
 return `${name} · ${match[1]}`;
}
