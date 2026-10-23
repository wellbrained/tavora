import { DOMParser } from '@xmldom/xmldom';
type XmlElement = Element;
import lookup from './character-data.json';
import { portable, type Build, type Gem, type Item, type Stage } from './model';
import { validate } from './validate.js';
import { t } from './i18n';

export const MAX_XML_BYTES = 8 * 1024 * 1024;
const MAX_CODE_BYTES = 4 * 1024 * 1024;
export const cleanGameText = (text: string) => text.replace(/\[([^\]|]+)\|([^\]]+)\]/g,'$2').replace(/\[([^\]]+)\]/g,'$1');
const attr = (e: XmlElement, name: string) => e.getAttribute(name) || '';
const children = (e: XmlElement, tag: string): XmlElement[] => Array.from(e.childNodes).filter((n): n is XmlElement=>n.nodeType===1 && n.nodeName===tag);
const first = (e: XmlElement, tag: string) => children(e,tag)[0];
const number = (value: string, fallback = 0) => /^\d+$/.test(value) ? Number(value) : fallback;
const gemData = lookup.gems as Record<string,{name:string;attributes:string[];support:boolean;tags:string[]}>;

/** Decode a direct PoB export code. Read output incrementally so a zip bomb is never buffered. */
export async function decodePob(input: string): Promise<string> {
 const code = input.trim();
 if (code.startsWith('<')) {
  if (new TextEncoder().encode(code).length > MAX_XML_BYTES) throw Error(t('error.pobTooBig'));
  return code;
 }
 if (!code || code.length > MAX_CODE_BYTES || !/^[A-Za-z0-9_+\/-]+={0,2}$/.test(code))
  throw Error(t('error.pobNotCode'));
 let bytes: Uint8Array;
 try { bytes = Uint8Array.from(atob(code.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0)); }
 catch { throw Error(t('error.pobCode')); }
 const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
 const chunks: Uint8Array[] = []; let size = 0;
 try {
  while (true) {
   const {value,done} = await reader.read(); if (done) break;
   size += value.byteLength;
   if (size > MAX_XML_BYTES) { await reader.cancel(); throw Error(t('error.pobExpanded')); }
   chunks.push(value);
  }
 } catch (error) { if (error instanceof Error && error.message === t('error.pobExpanded')) throw error; throw Error(t('error.pobDecompress')); }
 finally { reader.releaseLock(); }
 const output = new Uint8Array(size); let offset=0;
 for (const chunk of chunks) { output.set(chunk,offset); offset+=chunk.length; }
 try { return new TextDecoder('utf-8',{fatal:true}).decode(output); }
 catch { throw Error(t('error.pobText')); }
}

const slotNames: Record<string,string> = {'Weapon 1':'Weapon1','Weapon 1 Swap':'Weapon2','Weapon 2':'Offhand1','Weapon 2 Swap':'Offhand2',Helmet:'Helm1','Body Armour':'BodyArmour1',Gloves:'Gloves1',Boots:'Boots1',Belt:'Belt1',Amulet:'Amulet1','Ring 1':'Ring1','Ring 2':'Ring2','Charm 1':'Charm1','Charm 2':'Charm2','Charm 3':'Charm3','Flask 1':'Flask1','Flask 2':'Flask2'};
const sectionNames = ['implicitMods','explicitMods','fracturedMods','craftedMods','desecratedMods','enchantMods','runeMods','bondedMods'] as const;

function parseItem(element: XmlElement, slot: string): Item {
 // Only text children belong to the item; ModRange children are not modifier lines.
 const text = Array.from(element.childNodes).filter(n=>n.nodeType===3 || n.nodeType===4).map(n=>n.nodeValue).join('');
 const lines = text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
 const rarity = /^Rarity: (NORMAL|MAGIC|RARE|UNIQUE)$/i.exec(lines[0]||'')?.[1]?.toLowerCase();
 if (!rarity) throw Error(t('error.pobRarity'));
 const rare = ['rare','unique'].includes(rarity), base = lines[rare?2:1] || '', name=lines[1]||base;
 const item: Item = {inventory_id:slot,name,base,rarity,mods:[],exact:true,sourceSections:[],sourceText:text.trim()};
 const implicitAt=lines.findIndex(l=>/^Implicits: \d+$/.test(l));
 if(implicitAt<0) throw Error(t('error.pobBoundary'));
 const metadata=lines.slice(rare?3:2,implicitAt), get=(key:string)=>metadata.find(l=>l.startsWith(key+': '))?.slice(key.length+2);
 if(get('Item Level'))item.itemLevel=number(get('Item Level')!);
 if(get('Quality'))item.quality=number(get('Quality')!.replace('%',''));
 if(get('LevelReq'))item.level=number(get('LevelReq')!);
 item.requirements=item.level?[{name:'Level',values:[[String(item.level),0]]}]:[];
 for(const [label,key] of [['Str','StrReq'],['Dex','DexReq'],['Int','IntReq']]) {
  const value=get(key!); if(value) item.requirements.push({name:label!,values:[[value,0]]});
 }
 const ignored=new Set(['Unique ID','Item Level','Quality','LevelReq','StrReq','DexReq','IntReq','Sockets','Rune','Crafted','Prefix','Suffix','Variant','Selected Variant','Has Alt Variant','Selected Alt Variant','Selected Alt Variant Two','Selected Alt Variant Three','Selected Alt Variant Four','Selected Alt Variant Five']);
 item.properties=metadata.flatMap(line=>{const m=/^([^:]+): (.+)$/.exec(line);return m&&!ignored.has(m[1]!)?[{name:m[1]!,values:[[m[2]!,0] as [string,number]]}]:[];});
 if(item.quality)item.properties.unshift({name:'Quality',values:[['+'+item.quality+'%',0]]});
 const sections=new Map<string,string[]>(), implicitCount=number(lines[implicitAt]!.split(': ')[1]!);
 const variant=attr(element,'variant')||get('Selected Variant')||'1';
 for(const [index,line] of lines.slice(implicitAt+1).entries()) {
  if (/^(Corrupted|Mirrored|Split|Unidentified)$/.test(line)) {if(line==='Corrupted')item.corrupted=true;continue;}
  const restriction=/\{variant:([\d,]+)\}/.exec(line);
  if(restriction&&!restriction[1]!.split(',').includes(variant))continue;
  const kind=/\{rune\}/.test(line)?'runeMods':/\{crafted\}/.test(line)?'craftedMods':/\{fractured\}/.test(line)?'fracturedMods':/\{enchant\}/.test(line)?'enchantMods':index<implicitCount?'implicitMods':'explicitMods';
  const value=cleanGameText(line.replace(/\{[^}]*\}/g,''));
  if(!value)continue;
  if(value.startsWith('Grants Skill: ')) { (item.grantedSkills??=[]).push({name:'Grants Skill',values:[[value.slice(14),0]]}); continue; }
  if(!sections.has(kind))sections.set(kind,[]); sections.get(kind)!.push(value);
 }
 item.sourceSections=[...sections].map(([kind,mods])=>({kind,mods}));
 item.mods=item.sourceSections.flatMap(s=>s.mods);
 return item;
}

function parseGem(element: XmlElement): Gem {
 const id=attr(element,'gemId'), known=gemData[id];
 const name=attr(element,'nameSpec') || known?.name;
 if(!name)throw Error(t('error.pobGem'));
 return {id:id||name,name,isSupport:known?.support ?? /SupportGem/.test(id),attributes:known?.attributes||[],tags:known?.tags||[],...(number(attr(element,'level'))?{level:number(attr(element,'level'))}:{}),quality:number(attr(element,'quality'))};
}

function parseSkills(element: XmlElement): Gem[] {
 return children(element,'Skill').flatMap(group=>{
  const gems=children(group,'Gem').map(parseGem); if(!gems.length)return [];
  const active=gems.find(g=>!g.isSupport)||gems[0]!;
  return [{...active,supports:gems.filter(g=>g!==active)}];
 });
}

function allocations(spec: XmlElement): Stage['passives'] {
 const ids=(value:string)=>value.split(',').filter(Boolean).map(id=>{if(!/^\d+$/.test(id))throw Error(t('error.pobNode'));return id;});
 const one=new Set(ids(attr(first(spec,'WeaponSet1')||spec,'nodes'))), two=new Set(ids(first(spec,'WeaponSet2')?attr(first(spec,'WeaponSet2')!,'nodes'):''));
 // A missing WeaponSet1 means no set-specific nodes, not the entire tree.
 if(!first(spec,'WeaponSet1'))one.clear();
 const all=new Set([...ids(attr(spec,'nodes')),...one,...two]);
 return [...all].flatMap(id=>one.has(id)&&two.has(id)?[{id,weapon:1},{id,weapon:2}]:[{id,weapon:one.has(id)?1:two.has(id)?2:0}]);
}

export interface PobResult { build: Build; itemIds: Map<string,string>; warnings: string[] }
export function parsePob(xml: string, name = 'PoB character'): PobResult {
 if(new TextEncoder().encode(xml).length>MAX_XML_BYTES)throw Error(t('error.pobTooBig'));
 if(/<!\s*(?:DOCTYPE|ENTITY)/i.test(xml))throw Error(t('error.pobEntities'));
 let doc;
 try { doc=new DOMParser({errorHandler:{warning:()=>{throw Error('Malformed XML');},error:()=>{throw Error('Malformed XML');},fatalError:()=>{throw Error('Malformed XML');}}}).parseFromString(xml,'text/xml'); }
 catch { throw Error(t('error.pobMalformed')); }
 const root=doc.documentElement;
 if(!root || root.nodeName!=='PathOfBuilding2')throw Error(t('error.pobVersion'));
 const all=Array.from(root.getElementsByTagName('*')); if(all.length>50000)throw Error(t('error.pobEntries'));
 const info=first(root,'Build'), itemRoot=first(root,'Items'), skillsRoot=first(root,'Skills'), treeRoot=first(root,'Tree');
 if(!info||!itemRoot||!skillsRoot||!treeRoot)throw Error(t('error.pobMissing'));
 const warnings=['PoB can include planned equipment and skills. Imported data reflects the export.','Unresolved affix tiers and item properties are left blank.'];
 const items=new Map(children(itemRoot,'Item').map(i=>[attr(i,'id'),i]));
 const itemIds=new Map<string,string>();
 const itemSets=children(itemRoot,'ItemSet'); if(!itemSets.length)itemSets.push(itemRoot);
 const skillSets=children(skillsRoot,'SkillSet'); if(!skillSets.length)skillSets.push(skillsRoot);
 const specs=children(treeRoot,'Spec'); if(!specs.length)throw Error(t('error.pobNoTree'));
 if(itemSets.length+skillSets.length+specs.length>101)throw Error(t('error.pobProfiles'));
 const versions=specs.map(s=>attr(s,'treeVersion').replace('_','.'));
 if(versions.some(v=>!['0.4','0.5'].includes(v)))throw Error(t('error.pobTreeVersion'));
 const activeIndex=(list:XmlElement[],id:string,byPosition=false)=>{
  const index=byPosition?number(id,1)-1:list.findIndex(e=>attr(e,'id')===id);
  if(index<0||index>=list.length)throw Error(t('error.pobProfile')); return index;
 };
 const ai=itemSets.length===1?0:activeIndex(itemSets,attr(itemRoot,'activeItemSet'));
 const as=skillSets.length===1?0:activeIndex(skillSets,attr(skillsRoot,'activeSkillSet'));
 const at=specs.length===1?0:activeIndex(specs,attr(treeRoot,'activeSpec'),true);
 const equipment=itemSets.map(set=>children(set,'Slot').flatMap(slot=>{
  const id=attr(slot,'itemId');if(!id||id==='0')return [];
  const inventory=slotNames[attr(slot,'name')]; if(!inventory){warnings.push(`Not displayed: equipment slot ${attr(slot,'name')}.`);return [];}
  const element=items.get(id);if(!element)throw Error(t('error.pobItem'));
  const item=parseItem(element,inventory);
  const uid=/^Unique ID: (\S+)/m.exec(item.sourceText||'')?.[1];
  if(uid)itemIds.set(inventory+':'+attr(set,'id'),uid);
  return [item];
 }));
 const skills=skillSets.map(parseSkills), passives=specs.map(allocations);
 const ascendancies=specs.map((s,i)=>(lookup.ascendancies as Record<string,Record<string,string>>)[versions[i]!]![attr(s,'ascendancyInternalId')]||attr(info,'ascendClassName')||attr(info,'className'));
 const make=(label:string,i=ai,s=as,t=at,kind:NonNullable<Stage['characterProfile']>='active'):Stage=>({name:label,label,author:'',items:equipment[i]!,skills:skills[s]!,passives:passives[t]!,ascendancy:ascendancies[t]!,treeVersion:versions[t]!,characterProfile:kind,weaponSet:attr(itemSets[i]!,'useSecondWeaponSet')==='true'?2:1});
 const stages=[make('Active setup')];
 itemSets.forEach((e,i)=>{if(i!==ai)stages.push(make(attr(e,'title')||`Equipment ${i+1}`,i,as,at,'gear'));});
 skillSets.forEach((e,i)=>{if(i!==as)stages.push(make(attr(e,'title')||`Skills ${i+1}`,ai,i,at,'skills'));});
 specs.forEach((e,i)=>{if(i!==at)stages.push(make(attr(e,'title')||`Tree ${i+1}`,ai,as,i,'tree'));});
 // Jewel sockets are retained in the source XML but not invented as equipment slots.
 if(specs.some(s=>first(s,'Sockets')&&children(first(s,'Sockets')!,'Socket').length))warnings.push('Socketed tree jewels are retained in the source export; jewel tooltips are not supported yet.');
 const character={name:name.trim()||'PoB character',class:attr(info,'className'),level:number(attr(info,'level')),source:'PoB' as const,importedAt:new Date().toISOString()};
 const build:Build={id:'',fileId:crypto.randomUUID(),title:character.name+' · PoB',shortTitle:character.name,source:'PoB',version:'',treeVersion:versions[at]!,ascendancy:ascendancies[at]!,guideUrl:'',guideText:null,stages,defaultStage:0,character,importNotes:[...new Set(warnings)],characterExport:xml};
 return {build:validate(portable(build)),itemIds,warnings:[...new Set(warnings)]};
}
