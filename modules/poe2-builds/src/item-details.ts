import type {Item,AffixRow,ItemProperty} from './model';
import {itemImage} from './item-art';
import {esc} from './html';

export const cleanStat=(s:string)=>s.replace(/\[([^\]|]+)\|([^\]]+)\]/g,'$2').replace(/\[([^\]]+)\]/g,'$1');
const ordinary=['explicitMods','fracturedMods','craftedMods','desecratedMods'];
const socketed=['runeMods','enchantMods','bondedMods'];
function values(p:ItemProperty){return p.values.map(v=>`<span class="item-property-value">${esc(cleanStat(v[0]))}</span>`).join(', ');}
function property(p:ItemProperty){
 const name=cleanStat(p.name).replace(/:$/,'');
 return /\{\d+\}/.test(name)?esc(name).replace(/\{(\d+)\}/g,(_,n)=>esc(cleanStat(p.values[Number(n)]?.[0]||''))):`${esc(name)}: ${values(p)}`;
}
function label(a:AffixRow){return `${a.type==='P'?'Prefix':'Suffix'}${a.tier?' · Tier '+a.tier:' · Tier cannot be uniquely determined'}${a.name?' · '+a.name:''}${a.hybrid?' · One hybrid affix spanning connected lines':''}`;}
function affixInfo(item:Item,text:string,kind:string){
 if(!ordinary.includes(kind)||item.rarity==='unique')return undefined;
 return item.affixRows?.find(a=>a.text===cleanStat(text));
}
function row(item:Item,text:string,kind:string){
 const info=affixInfo(item,text,kind),status=info?.status||({craftedMods:'Crafted',fracturedMods:'Fractured',desecratedMods:'Desecrated'}[kind]||'');
 const badges=info?(info.contributors?.length?info.contributors:[info]).map(a=>`<abbr title="${esc(label(a))}">[${a.type}${a.tier||''}]</abbr>`).join(' '):'';
 return `<li${info?.hybrid?` class="hybrid-affix hybrid-${info.hybrid}"`:''}><span>${esc(cleanStat(text))}</span><span class="affix-badges">${status?`<small class="affix-status ${status.toLowerCase()}">${status}</small>`:''}${badges}</span></li>`;
}
export function itemDetails(item:Item,notes=''):string{
 const image=itemImage(item),quality=(item.properties||[]).filter(p=>/^Quality/.test(cleanStat(p.name)));
 const rarity=item.rarity&&['normal','magic','rare','unique'].includes(item.rarity)?item.rarity:'unknown';
 const sections=item.sourceSections?.length?item.sourceSections:[{kind:'explicitMods',mods:item.mods}];
 const rows=sections.filter(s=>ordinary.includes(s.kind)).flatMap(s=>s.mods.map(text=>({text,kind:s.kind})));
 const first=new Map<string,number>(),positions=new Map(rows.map((r,i)=>[r,i]));
 rows.forEach((r,i)=>{const a=affixInfo(item,r.text,r.kind),key=a?.instanceId||a?.id;if(key&&!first.has(key))first.set(key,i);});
 const rank=(r:typeof rows[number])=>{const a=affixInfo(item,r.text,r.kind);return a?.type==='P'?0:a?.type==='S'?1:2;};
 rows.sort((a,b)=>{const order=rank(a)-rank(b);if(order)return order;const x=affixInfo(item,a.text,a.kind),y=affixInfo(item,b.text,b.kind);return (first.get(x?.instanceId||x?.id||'')??positions.get(a)!)-(first.get(y?.instanceId||y?.id||'')??positions.get(b)!);});
 const implicit=sections.filter(s=>s.kind==='implicitMods').flatMap(s=>s.mods),runes=sections.filter(s=>socketed.includes(s.kind)).flatMap(s=>s.mods);
 const mods=(lines:{text:string;kind:string}[],heading='')=>lines.length?`<section class="item-mod-section">${heading?`<div class="item-mod-label">${heading}</div>`:''}<ul class="mods stat-list">${lines.map(r=>row(item,r.text,r.kind)).join('')}</ul></section>`:'';
 return `<div class="gear-item-body" data-rarity="${rarity}"><div class="item-art-column"><div class="gear-icon ${image.actual?'item-art':'slot-art'}"><img src="${image.src}" alt="" loading="lazy"></div>${item.requirements?.length?`<div class="item-requirements"><span class="requirements-label">Requires</span>${item.requirements.map(r=>`<span class="requirement-row"><span>${esc(cleanStat(r.name))}</span><b>${esc(r.values[0]?.[0]||'')}</b></span>`).join('')}</div>`:''}</div><div class="gear-details"><div class="item-name-row"><h2 class="gear-name rarity-${rarity}">${esc(item.name)}</h2>${item.itemLevel?`<span class="item-badge" title="Item level ${item.itemLevel}">ilvl ${item.itemLevel}</span>`:''}${quality.map(p=>`<span class="item-badge">${property(p)}</span>`).join('')}${!quality.length&&item.quality?`<span class="item-badge">Quality: +${item.quality}%</span>`:''}${rarity!=='unknown'?`<span class="rarity-badge rarity-${rarity} sr-only">${rarity[0]!.toUpperCase()+rarity.slice(1)}</span>`:''}</div>${item.base&&item.base!==item.name?`<div class="unique-base">${esc(item.base)}</div>`:''}<div class="item-properties">${(item.properties||[]).filter(p=>p.values.length&&!/^Quality/.test(cleanStat(p.name))).map(p=>`<div>${property(p)}</div>`).join('')}</div>${item.grantedSkills?.length?`<div class="item-granted">${item.grantedSkills.map(property).join('<br>')}</div>`:''}${mods(implicit.map(text=>({text,kind:'implicitMods'})),'Implicit')}${mods(rows)}${mods(runes.map(text=>({text,kind:'runeMods'})),'Socketed effects')}${item.corrupted?'<div class="item-corrupted">Corrupted</div>':''}${item.dps?`<div class="item-dps">DPS <b>${item.dps}</b></div>`:''}${item.reference?'<div class="reference-label">PoB reference · exact rolls not exported</div>':''}${notes}</div></div>`;
}
export function equipmentOrder(item:Item):number{
 const id=item.inventory_id,n=Number(id.slice(-1))||1;
 if(/^Weapon[12]$/.test(id))return n-1;
 if(/^Offhand[12]$/.test(id))return 2+n-1;
 const fixed=['Helm1','BodyArmour1','Gloves1','Boots1','Belt1','Amulet1','Ring1','Ring2'];
 if(fixed.includes(id))return 4+fixed.indexOf(id);
 if(/^Charm[123]$/.test(id))return 12+(id==='Charm1'?(item.slot_x||0):n-1);
 if(/^Flask[12]$/.test(id))return 15+(id==='Flask1'?(item.slot_x||0):1);
 return 99;
}
