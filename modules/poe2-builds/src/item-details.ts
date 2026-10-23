import type {TooltipContent} from '@tavora/sdk';
import {resolveItemIdentity} from './item-identity.js';
import type {Item,AffixRow,ItemProperty} from './model';
import {itemImage} from './item-art';
import {esc} from './html';
import {t} from './i18n';

export const cleanStat=(s:string)=>s.replace(/\[([^\]|]+)\|([^\]]+)\]/g,'$2').replace(/\[([^\]]+)\]/g,'$1');
const ordinary=['explicitMods','fracturedMods','craftedMods','desecratedMods'];
const socketed=['runeMods','enchantMods','bondedMods'];
function values(p:ItemProperty){return p.values.map(v=>`<span class="item-property-value">${esc(cleanStat(v[0]))}</span>`).join(', ');}
/** Fills poe.ninja templates such as "Recovers {0} Life over {1} Seconds"; undefined for plain "Name: value" properties. */
function filled(p:ItemProperty){
 const name=cleanStat(p.name).replace(/:$/,'');
 return /\{\d+\}/.test(name)?name.replace(/\{(\d+)\}/g,(_,n)=>cleanStat(p.values[Number(n)]?.[0]||'')):undefined;
}
function property(p:ItemProperty){
 const text=filled(p);
 return text!==undefined?esc(text):`${esc(cleanStat(p.name).replace(/:$/,''))}: ${values(p)}`;
}
function label(a:AffixRow){return `${t(a.type==='P'?'gear.prefix':'gear.suffix')} · ${a.tier?t('gear.tier',{tier:a.tier}):t('gear.tierUnknown')}${a.name?' · '+a.name:''}${a.hybrid?' · '+t('gear.hybrid'):''}`;}
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
 return `<div class="gear-item-body" data-rarity="${rarity}"><div class="item-art-column"><div class="gear-icon ${image.actual?'item-art':'slot-art'}"><img src="${image.src}" alt="" loading="lazy"></div>${item.requirements?.length?`<div class="item-requirements"><span class="requirements-label">${esc(t('gear.requires'))}</span>${item.requirements.map(r=>`<span class="requirement-row"><span>${esc(cleanStat(r.name))}</span><b>${esc(r.values[0]?.[0]||'')}</b></span>`).join('')}</div>`:''}</div><div class="gear-details"><div class="item-name-row"><h2 class="gear-name rarity-${rarity}">${esc(item.name)}</h2>${item.itemLevel?`<span class="item-badge" title="${esc(t('gear.itemLevel',{level:item.itemLevel}))}">ilvl ${item.itemLevel}</span>`:''}${quality.map(p=>`<span class="item-badge">${property(p)}</span>`).join('')}${!quality.length&&item.quality?`<span class="item-badge">Quality: +${item.quality}%</span>`:''}${rarity!=='unknown'?`<span class="rarity-badge rarity-${rarity} sr-only">${rarity[0]!.toUpperCase()+rarity.slice(1)}</span>`:''}</div>${item.base&&item.base!==item.name?`<div class="unique-base">${esc(item.base)}</div>`:''}<div class="item-properties">${(item.properties||[]).filter(p=>p.values.length&&!/^Quality/.test(cleanStat(p.name))).map(p=>`<div>${property(p)}</div>`).join('')}</div>${item.grantedSkills?.length?`<div class="item-granted">${item.grantedSkills.map(property).join('<br>')}</div>`:''}${mods(implicit.map(text=>({text,kind:'implicitMods'})),esc(t('gear.implicit')))}${mods(rows)}${mods(runes.map(text=>({text,kind:'runeMods'})),esc(t('gear.socketed')))}${item.corrupted?'<div class="item-corrupted">Corrupted</div>':''}${item.dps?`<div class="item-dps">DPS <b>${item.dps}</b></div>`:''}${item.reference?`<div class="reference-label">${esc(t('gear.reference'))}</div>`:''}${notes}</div></div>`;
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

/** Portable structured content for the host-owned overlay; the host never receives markup. */
export function itemTooltipContent(item:Item,notes?:string):TooltipContent{
 item=resolveItemIdentity(item);
 const image=itemImage(item),sections=item.sourceSections?.length?item.sourceSections:[{kind:'explicitMods',mods:item.mods}];
 const rows=sections.filter(s=>ordinary.includes(s.kind)).flatMap(s=>s.mods.map(text=>({text,kind:s.kind})));
 const first=new Map<string,number>();rows.forEach((r,i)=>{const a=affixInfo(item,r.text,r.kind),key=a?.instanceId||a?.id;if(key&&!first.has(key))first.set(key,i);});
 const positions=new Map(rows.map((r,i)=>[r,i]));
 const rank=(r:typeof rows[number])=>{const a=affixInfo(item,r.text,r.kind);return a?.type==='P'?0:a?.type==='S'?1:2;};
 rows.sort((a,b)=>rank(a)-rank(b)||(first.get(affixInfo(item,a.text,a.kind)?.instanceId||affixInfo(item,a.text,a.kind)?.id||'')??positions.get(a)!)-(first.get(affixInfo(item,b.text,b.kind)?.instanceId||affixInfo(item,b.text,b.kind)?.id||'')??positions.get(b)!));
 const row=(text:string,kind:string)=>{const a=affixInfo(item,text,kind),status=a?.status||({craftedMods:'Crafted',fracturedMods:'Fractured',desecratedMods:'Desecrated'}[kind]||'');return{text:cleanStat(text),...(a?{badges:(a.contributors?.length?a.contributors:[a]).map(b=>`[${b.type}${b.tier||''}]`)}:{}),...(status?{status}:{}),...(a?.hybrid?{connected:true}:{})};};
 // The host needs a non-empty label and value, so a template splits at its first placeholder: "Recovers: 552 Life over 3 Seconds".
 const property=(p:ItemProperty)=>{
  const text=filled(p);if(text===undefined)return{label:cleanStat(p.name).replace(/:$/,''),value:p.values.map(v=>cleanStat(v[0])).join(', ')};
  const lead=cleanStat(p.name).split(/\{\d+\}/)[0]!.trim(),at=lead?lead.length:text.indexOf(' ');
  return at>0?{label:text.slice(0,at).trim(),value:text.slice(at).trim()}:{label:text,value:'-'};
 };
 const quality=(item.properties||[]).filter(p=>/^Quality/.test(cleanStat(p.name)));
 const content:TooltipContent={title:item.name,...(item.base&&item.base!==item.name?{subtitle:item.base}:{}),...(item.rarity&&['normal','magic','rare','unique'].includes(item.rarity)?{tone:item.rarity as NonNullable<TooltipContent['tone']>}:{}),
  ...(/\.(png|webp|jpe?g|gif)$/i.test(image.src)?{image:'dist/'+image.src.replace(/^\.\//,'')}:{}),
  badges:[...(item.itemLevel?[`ilvl ${item.itemLevel}`]:[]),...quality.map(p=>{const q=property(p);return q.label+': '+q.value;}),...(!quality.length&&item.quality?[`Quality: +${item.quality}%`]:[])],
  requirements:(item.requirements||[]).map(property),properties:[...(item.properties||[]).filter(p=>p.values.length&&!/^Quality/.test(cleanStat(p.name))).map(property),...(item.grantedSkills||[]).map(property)],sections:[]};
 const add=(lines:{text:string;kind:string}[],title?:string)=>{if(lines.length)content.sections!.push({...(title?{title}:{}),rows:lines.map(r=>row(r.text,r.kind))});};
 add(sections.filter(s=>s.kind==='implicitMods').flatMap(s=>s.mods.map(text=>({text,kind:s.kind}))),t('gear.implicit'));add(rows);
 add(sections.filter(s=>socketed.includes(s.kind)).flatMap(s=>s.mods.map(text=>({text,kind:s.kind}))),t('gear.socketed'));
 if(item.corrupted)add([{text:'Corrupted',kind:'info'}]);
 if(item.dps)add([{text:'DPS: '+item.dps,kind:'info'}]);
 if(notes?.trim())add([{text:notes.trim(),kind:'notes'}],t('notes.title'));
 return content;
}
