import type { TavoraSDK } from '@tavora/sdk';
import lookup from './character-data.json';
import trees from './trees.json';
import uniqueReferences from './unique-references.json';
import { portable, type Build, type Gem, type Guide, type Item, type Stage } from './model';
import { validate } from './validate.js';
import { cleanGameText } from './pob-import';
import { t } from './i18n';

type Obj = Record<string, unknown>;
const obj = (v:unknown):Obj => v && typeof v==='object' && !Array.isArray(v) ? v as Obj : {};
const arr = (v:unknown):unknown[] => Array.isArray(v) ? v : [];
const str = (v:unknown):string => typeof v==='string' ? v : '';
const items = (v:unknown) => arr(v).map(obj);
const text = (v:unknown) => cleanGameText(str(v));
export interface GuideImport { build:Build; warnings:string[]; method:'direct'|'browser'|'file' }
/** Raise version when the mapping changes; patches lists the game versions the bundled tree supports. */
export const MOBALYTICS_ADAPTER={source:'Mobalytics',version:'2',patches:['0.5']} as const;

export function mobalyticsAddress(input:string):{url:string;canonical:string;variant:string} {
 let u:URL;try{u=new URL(input.trim());}catch{throw Error(t('error.mobalyticsUrl'));}
 if(u.protocol!=='https:'||u.hostname!=='mobalytics.gg'||u.port||u.username||u.password||!/^\/poe-2\/builds\/[a-z0-9-]+\/?$/.test(u.pathname))throw Error(t('error.mobalyticsPath'));
 const canonical=u.origin+u.pathname.replace(/\/$/,'');
 let variant='';for(const [key,value] of u.searchParams)if(/^ws-/.test(key)&&value.startsWith('activeVariantId,'))variant=value.slice('activeVariantId,'.length);
 return {url:u.href,canonical,variant};
}

/** JSON only: never evaluate source scripts. Braces and escapes inside strings stay intact. */
export function publicDocument(html:string):Obj {
 if(html.length>5*1024*1024)throw Error(t('error.pageTooBig'));
 const marker='window.__PRELOADED_STATE__=', at=html.indexOf(marker);
 if(at<0)throw Error(t('error.noGuideData'));
 let start=at+marker.length;while(/\s/.test(html[start]||'')&&start<html.length)start++;
 let depth=0,quoted=false,escaped=false,end=start;
 for(;end<html.length;end++){
  const c=html[end];
  if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
  if(c==='"')quoted=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0){end++;break;}
 }
 let state:unknown;try{state=JSON.parse(html.slice(start,end));}catch{throw Error(t('error.incompleteGuide'));}
 const queue:unknown[]=[state];let count=0;
 while(queue.length&&++count<30000){
  const value=obj(queue.shift());
  for(const key of ['userGeneratedDocumentBySlug','userGeneratedDocumentBySlugifiedName']){
   const document=obj(obj(value[key]).data);
   if(Array.isArray(obj(obj(document.data).buildVariants).values)&&Array.isArray(document.content))return document;
  }
  for(const entry of Object.values(value))if(entry&&typeof entry==='object')Array.isArray(entry)?queue.push(...entry):queue.push(entry);
 }
 throw Error(t('error.notMobalytics'));
}

/** Preserve original words and inline reference labels; links become safe, readable URLs. */
export function lexicalText(value:unknown, base:string, depth=0, ordered=false):string {
 if(depth>40)throw Error(t('error.nestedText'));
 const node=obj(value);
 if(node.root)return lexicalText(node.root,base,depth+1).trim();
 if(node.type==='text')return str(node.text);
 if(node.type==='static-data-widget')return str(node.label);
 if(node.type==='linebreak')return '\n';
 const children=arr(node.children).map(child=>lexicalText(child,base,depth+1,node.type==='list'&&node.listType==='number')).join('');
 if(node.type==='link'||node.type==='autolink'){
  try{const u=new URL(str(node.url),base);if(['https:','http:'].includes(u.protocol)&&!u.username&&!u.password)return children.includes(u.href)?children:`${children} (${u.href})`;}catch{/* Keep original label. */}
 }
 if(node.type==='listitem')return `${ordered?String(node.value||1)+'. ':'• '}${children.trim()}\n`;
 if(['paragraph','heading','list'].includes(str(node.type)))return children+'\n\n';
 return children;
}

const gemsByEffect=new Map(Object.entries(lookup.gems).map(([id,g])=>[g.effect.toLowerCase(),{id,...g}]));
const gemsByName=new Map(Object.entries(lookup.gems).map(([id,g])=>[g.name.toLowerCase(),{id,...g}]));
const requirement=[1,3,6,10,14,18,22,26,31,36,41,46,52,58,64,66,72,78,84,90];
function gem(source:Obj, support=false):Gem {
 const slug=str(source.gemSlug),known=gemsByEffect.get(slug.toLowerCase())||gemsByName.get(str(source.name).toLowerCase());
 if(!known&&!str(source.name))throw Error(t('error.skillNotBundled',{id:slug}));
 return {id:known?.gameId||known?.id||slug,name:str(source.name)||known!.name,attributes:known?.attributes||[],isSupport:known?.support??support,tags:known?.tags||[],...(known&&!known.support&&known.tier>0?{levels:[requirement[known.tier-1]||1]}:{}),...(typeof source.level==='number'?{level:source.level}:{})};
}
const slots:Record<string,string>={mainHand:'Weapon',offHand:'Offhand',helmet:'Helm1',body:'BodyArmour1',gloves:'Gloves1',boots:'Boots1',belt:'Belt1',amulet:'Amulet1',leftRing:'Ring1',rightRing:'Ring2',charm1:'Charm1',charm2:'Charm2',charm3:'Charm3',flask1:'Flask1',flask2:'Flask2'};
function equipment(value:unknown, key:string, set=1):Item|null {
 const container=obj(value),common=obj(container.commonItem);
 if(!str(common.name))return null;
 let modifiers=items(common.explicitDescriptions).map(m=>text(m.description)).filter(Boolean);
 let implicit=items(common.implicitDescriptions).map(m=>text(m.description)).filter(Boolean);
 const reference=common.isUnique===true&&!modifiers.length&&!implicit.length?(uniqueReferences as Record<string,{base:string;implicit:string[];explicit:string[]}>)[text(common.name)]:undefined;
 if(reference){modifiers=reference.explicit;implicit=reference.implicit;}
 const inventory_id=slots[key]!+(['mainHand','offHand'].includes(key)?set:'');
 const stats=items(common.stats).filter(s=>str(s.name)&&str(s.value));
 return {inventory_id,name:text(common.name),base:text(common.baseType)||reference?.base||text(common.name),category:str(common.itemClassSlug),mods:[...implicit,...modifiers],...(common.isUnique===true?{rarity:'unique'}:{}),...(reference?{reference:true}:{}),
  sourceSections:[{kind:'implicitMods',mods:implicit},{kind:'explicitMods',mods:modifiers}],
  properties:stats.map(s=>({name:text(s.name),values:[[text(s.value),0]]})),
  requirements:items(common.requirements).filter(r=>str(r.name)&&str(r.value)).map(r=>({name:text(r.name),values:[[text(r.value),0]]})),
  sourceModifiers:['prefixes','suffixes'].flatMap(kind=>items(common[kind]).filter(m=>str(m.slug)).map(m=>({kind:kind==='prefixes'?'prefix':'suffix',id:str(m.slug),stats:{}}))),
 };
}

export function parseMobalytics(document:Obj,input:string):Build {
 const address=mobalyticsAddress(input),data=obj(document.data),content=items(document.content),variants=items(obj(data.buildVariants).values);
 if(!variants.length||variants.length>50||!str(data.name))throw Error(t('error.noVariants'));
 const variantWidget=content.find(c=>Array.isArray(obj(c.data).childrenVariants));
 const labels=items(obj(variantWidget?.data).childrenVariants);
 const nodes=trees['0.5'] as {id:string;ascendancy:string|null}[];
 const guide:Guide={url:address.canonical,sections:[],stageNotes:{},items:{},gems:{}};
 const byId=new Map(content.map(c=>[str(c.id),c]));
 const title=text(data.name);
 const sourceVersion=/\b(0\.\d+(?:\.\d+)?)\b/.exec(title)?.[1]||'';
 if(sourceVersion&&!MOBALYTICS_ADAPTER.patches.some(p=>sourceVersion===p||sourceVersion.startsWith(p+'.')))throw Error(t('error.gameVersion'));
 const knownNodes=new Set(nodes.map(n=>n.id));
 const stages:Stage[]=variants.map((variant,index)=>{
  const label=text(labels.find(v=>v.id===variant.id)?.title)||`Variant ${index+1}`;
  const tree=obj(variant.passiveTree),passives:Stage['passives']=[];
  for(const [field,weapon] of [['mainTree',0],['ascendancyTree',0],['set1Tree',1],['set2Tree',2]] as const)
   for(const slug of arr(obj(tree[field]).selectedSlugs)){
    const id=/^node-(\d+)$/.exec(str(slug))?.[1];if(!id||!knownNodes.has(id))throw Error(t('error.treeNotBundled'));
    if(!passives.some(p=>p.id===id&&p.weapon===weapon))passives.push({id,weapon});
   }
  const equipmentData=obj(variant.equipment),equipped:Item[]=[];
  for(const key of Object.keys(slots)){
   if(['mainHand','offHand'].includes(key)){for(const set of [1,2]){const item=equipment(obj(equipmentData[key])['set'+set],key,set);if(item)equipped.push(item);}}
   else{const item=equipment(equipmentData[key],key);if(item)equipped.push(item);}
  }
  const skills=items(obj(variant.skillGems).gems).map(group=>({...gem(obj(group.activeSkill)),supports:items(group.subSkills).map(s=>gem(s,s.gemType==='SUPPORT'))}));
  const ascendancy=nodes.find(n=>n.ascendancy&&passives.some(p=>p.id===n.id))?.ascendancy||'';
  return {name:label,label,author:'',link:address.canonical,ascendancy,items:equipped,skills,passives};
 });
 const section=(node:Obj,variantIndex?:number)=>{
  const info=obj(node.data),label=stages[variantIndex??-1]?.label;
  const fields=['simplifiedContent','descriptionPoeEquipment','descriptionPoeSkillGems','descriptionPoe2PassiveTree','descriptionPoe2AtlasTree','strengths','weaknesses'];
  for(const field of fields){
   const body=lexicalText(obj(info[field]).value,address.canonical).trim();if(!body)continue;
   const context=field.includes('Equipment')?'gear':field.includes('SkillGems')?'skills':field.includes('PassiveTree')?'tree':'overview';
   guide.sections!.push({title:(text(info.title)||'Guide')+(label?' · '+label:''),text:body,context});
   if(variantIndex!==undefined&&['gear','skills','tree'].includes(context)){
    const notes=guide.stageNotes![String(variantIndex)]??={};
    notes[context as 'gear'|'skills'|'tree']=body.split(/\n\s*\n/)[0]||body;
   }
  }
 };
 const visited=new Set<string>();
 const walk=(id:string,variantIndex?:number)=>{
  if(visited.has(id))return;visited.add(id);const node=byId.get(id);if(!node)return;
  if(node===variantWidget){
   for(const entry of labels){const index=variants.findIndex(v=>v.id===entry.id);if(index<0)continue;
    const description=lexicalText(obj(entry.description).value,address.canonical).trim();
    if(description)guide.sections!.push({title:'Overview · '+stages[index]!.label,text:description,context:'overview'});
    for(const child of arr(entry.childrenIds))walk(str(child),index);
   }return;
  }
  section(node,variantIndex);for(const child of arr(obj(node.data).childrenIds))walk(str(child),variantIndex);
 };
 for(const id of arr(data.childrenIds))walk(str(id));
 if(!guide.sections!.length)throw Error(t('error.noGuideText'));
 const questSelections=items(obj(data.questRewards).quests).map(q=>({quest:text(obj(q.quest).name),act:text(obj(q.quest).act),area:text(obj(q.quest).area),reward:text(obj(q.reward).bakedDescription)})).filter(q=>q.reward);
 const b:Build={id:'imported',fileId:crypto.randomUUID(),title:title+' · Mobalytics',shortTitle:title,source:'Mobalytics',version:sourceVersion,treeVersion:'0.5',ascendancy:stages[0]!.ascendancy||'',guideUrl:address.canonical,guideText:guide,stages,defaultStage:Math.max(0,variants.findIndex(v=>v.id===address.variant)),questSelections,
  guideImport:{source:'Mobalytics',url:address.url,documentId:str(document.id),revision:String(document.version??''),importedAt:new Date().toISOString(),variantIds:variants.map(v=>str(v.id))},
  guideExport:JSON.stringify({id:document.id,version:document.version,data,content:content.filter(c=>!['NgfDocumentCmWidgetDiscoveryPreviewCompactV2','NgfDocumentCmWidgetCommentsV1','NgfDocumentCmWidgetPromoBannerHorizontalV1'].includes(str(c.__typename)))}),
  importerVersion:`${MOBALYTICS_ADAPTER.source} adapter ${MOBALYTICS_ADAPTER.version} · patch ${MOBALYTICS_ADAPTER.patches.join(', ')}`,
  importNotes:['Planner recommendations may omit rarity, exact item rolls and gem levels. Missing values remain empty.','Uniques without exact rolls use labelled PoB reference ranges. Affix tiers the guide doesn\'t give are left out, never guessed.',...keptNotes(variants)]};
 const video=content.find(c=>str(obj(c.data).videoUrl));if(video)b.video=str(obj(video.data).videoUrl);
 return validate(portable(b));
}

/** Names what the guide holds but Tavora doesn't show yet, and what the guide leaves open. The source data stays in guideExport. */
function keptNotes(variants:Obj[]):string[] {
 const tree=variants.map(v=>obj(v.passiveTree)),gear=variants.map(v=>obj(v.equipment));
 const unique=(list:Obj[],key:string)=>new Set(list.map(e=>str(e[key])).filter(Boolean)).size;
 const attributes=tree.flatMap(t=>items(t.attributeNodes)),open=unique(attributes.filter(a=>a.attribute==='any'),'nodeSlug');
 const jewels=unique(tree.flatMap(t=>items(t.jewels)),'nodeSlug'),cores=unique(gear.flatMap(g=>items(g.chakras)),'slug');
 return [
  ...(attributes.length?[`Attribute picks on ${unique(attributes,'nodeSlug')} passive nodes are saved but not shown yet.`]:[]),
  ...(open?[`The guide doesn't say which attribute to take on ${open} of them.`]:[]),
  ...(jewels?[`Jewels in ${jewels} tree sockets are saved but not shown yet.`]:[]),
  ...(cores?[`${cores} soul cores and runes are saved but not shown yet.`]:[]),
 ];
}

export async function importMobalytics(input:string,network:TavoraSDK['network']):Promise<GuideImport>{
 const address=mobalyticsAddress(input);let document:Obj|undefined,method:'direct'|'browser'='direct';
 try {const response=await network.fetch(address.url);if(response.status>=200&&response.status<300)document=publicDocument(response.body);}catch{/* Public rendering is the supported fallback. */}
 if(!document){method='browser';const page=await network.readPage(address.url);document=publicDocument(page.html);}
 const build=parseMobalytics(document,address.url);
 return {build,method,warnings:build.importNotes||[]};
}

export function prepareGuideSave(candidate:Build,name:string,target:Build|null):Build{
 if(candidate.character||target?.character)throw Error(t('error.guideOverCharacter'));
 const title=name.trim();if(!title||title.length>200)throw Error(t('error.buildName'));
 if(target?.guideImport&&candidate.guideImport&&target.guideImport.documentId!==candidate.guideImport.documentId)throw Error(t('error.otherGuide'));
 if(target?.guideText?.sections?.length&&!candidate.guideText?.sections?.length)throw Error(t('error.attachmentNoText'));
 if(target?.guideUrl&&candidate.guideUrl){const a=new URL(target.guideUrl),b=new URL(candidate.guideUrl);if(a.origin+a.pathname.replace(/\/$/,'')!==b.origin+b.pathname.replace(/\/$/,''))throw Error(t('error.otherGuide'));}
 return validate(portable({...candidate,fileId:target?.fileId||candidate.fileId,title:title+' · '+candidate.source,shortTitle:title}));
}
