import type { TavoraSDK } from '@tavora/sdk';
import { portable, MAX_FILE_BYTES, type Build, type Item, type ItemProperty } from './model';
import { validate } from './validate.js';
import { cleanGameText, decodePob, parsePob } from './pob-import';
import { t } from './i18n';

export interface CharacterImport { build: Build; warnings: string[] }
export function ninjaAddress(input: string) {
 let url:URL;
 try {url=new URL(input.trim());}catch{throw Error(t('error.ninjaUrl'));}
 const match=/^\/poe2\/builds\/([^/]+)\/character\/([^/]+)\/([^/]+)\/?$/.exec(url.pathname);
 if(url.protocol!=='https:'||url.hostname!=='poe.ninja'||url.username||url.password||url.port||!match)
  throw Error(t('error.ninjaCharacter'));
 const [league,account,name]=match.slice(1).map(s=>decodeURIComponent(s));
 if([league,account,name].some(s=>!s||s.length>200||/[\x00-\x1f]/.test(s!)))throw Error(t('error.ninjaAddress'));
 return {url:`https://poe.ninja/poe2/builds/${encodeURIComponent(league!)}/character/${encodeURIComponent(account!)}/${encodeURIComponent(name!)}`,league:league!,account:account!,name:name!};
}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const array=(v:unknown,max=500):unknown[]=>Array.isArray(v)?v.slice(0,max):[];
const string=(v:unknown)=>typeof v==='string'?v:'';
function properties(value:unknown):ItemProperty[]{return array(value,50).filter(object).map(p=>({name:cleanGameText(string(p.name)),values:array(p.values,20).filter(v=>Array.isArray(v)&&typeof v[0]==='string').map(v=>[cleanGameText((v as [string,number])[0]),Number((v as [string,number])[1])||0]),displayMode:typeof p.displayMode==='number'?p.displayMode:0}));}

/** Keep authoritative item sections and IDs. Text alone never determines affix type or tier. */
export function ninjaItem(source:Record<string,unknown>, fallback:Item):Item {
 const kinds=['implicitMods','explicitMods','fracturedMods','craftedMods','desecratedMods','enchantMods','runeMods','bondedMods'];
 const sourceSections=kinds.map(kind=>({kind,mods:array(source[kind]).filter((m):m is string=>typeof m==='string').map(cleanGameText)})).filter(s=>s.mods.length);
 const sourceModifiers=object(source.mods)?Object.entries(source.mods).flatMap(([kind,mods])=>array(mods,100).filter(object).map(m=>({kind,id:string(m.id),stats:object(m.stats)?Object.fromEntries(Object.entries(m.stats).filter((entry):entry is [string,number]=>typeof entry[1]==='number'&&Number.isFinite(entry[1]))):{}}))):[];
 const rarity=typeof source.rarity==='string'?source.rarity.toLowerCase():['normal','magic','rare','unique'][Number(source.frameType)];
 const req=properties(source.requirements), quality=properties(source.qualityProperty?[source.qualityProperty]:source.properties).find(p=>/^Quality/.test(p.name))?.values[0]?.[0];
 return {...fallback,name:cleanGameText(string(source.name)||string(source.typeLine)||fallback.name),base:cleanGameText(string(source.baseType)||fallback.base||''),...(rarity?{rarity}:{}),
  properties:properties(source.properties),requirements:req,grantedSkills:properties(source.grantedSkills),...(typeof source.ilvl==='number'?{itemLevel:source.ilvl}:{}),
  ...(Number(req.find(p=>p.name==='Level')?.values[0]?.[0])?{level:Number(req.find(p=>p.name==='Level')!.values[0]![0])}:{}),...(quality?{quality:Number(quality.replace(/[^\d.]/g,''))}:{}),
  corrupted:source.corrupted===true,mods:sourceSections.flatMap(s=>s.mods),sourceSections,sourceModifiers};
}

export async function importNinja(input:string, network:Pick<TavoraSDK['network'],'fetch'>):Promise<CharacterImport> {
 const address=ninjaAddress(input);
 const get=async(url:string):Promise<Record<string,unknown>>=>{
  const response=await network.fetch(url);
  if(response.status<200||response.status>=300)throw Error(t('error.ninjaStatus',{status:response.status}));
  if(response.body.length>5*1024*1024)throw Error(t('error.ninjaTooLarge'));
  let data:unknown;try{data=JSON.parse(response.body);}catch{throw Error(t('error.ninjaUnreadable'));}
  if(!object(data))throw Error(t('error.ninjaUnsupported'));return data;
 };
 const index=await get('https://poe.ninja/poe2/api/data/index-state');
 const snapshot=array(index.snapshotVersions,1000).filter(object).find(s=>s.url===address.league);
 if(!snapshot||typeof snapshot.version!=='string'||typeof snapshot.snapshotName!=='string')throw Error(t('error.ninjaLeague'));
 const query=new URLSearchParams({account:address.account,name:address.name,overview:snapshot.snapshotName,timeMachine:''});
 const data=await get(`https://poe.ninja/poe2/api/builds/${encodeURIComponent(snapshot.version)}/character?${query}`);
 if(data.name!==address.name||data.account!==address.account||typeof data.pathOfBuildingExport!=='string')throw Error(t('error.ninjaMismatch'));
 const xml=await decodePob(data.pathOfBuildingExport), parsed=parsePob(xml,address.name), build=parsed.build;
 const sourceItems=new Map([...array(data.items),...array(data.flasks),...array(data.jewels)].filter(object).map(i=>i.itemData).filter(object).map(i=>[string(i.id),i]));
 for(const stage of build.stages) stage.items=stage.items.map(item=>{
  const uid=/^Unique ID: (\S+)/m.exec(item.sourceText||'')?.[1], original=uid?sourceItems.get(uid):undefined;
  return original?ninjaItem(original,item):item;
 });
 const character={name:address.name,class:string(data.baseClass)||build.character!.class,level:typeof data.level==='number'?data.level:build.character!.level,source:'poe.ninja' as const,importedAt:new Date().toISOString(),url:address.url,account:address.account,league:string(data.league)||address.league};
 build.character=character;build.source='poe.ninja';build.title=address.name+' · poe.ninja';build.shortTitle=address.name;build.guideUrl=address.url;
 build.questStats=array(data.questStats,100).filter((v):v is string=>typeof v==='string').map(cleanGameText);
 const warnings=parsed.warnings.filter(w=>!w.startsWith('PoB can include'));
 warnings.unshift('poe.ninja provides its latest available snapshot; it may lag behind your in-game character.');
 build.importNotes=warnings;
 return {build:validate(portable(build)),warnings};
}

/** Explicit target selection prevents a PoB export from overwriting a guide or guessed character. */
export function prepareCharacterSave(candidate:Build, name:string, target:Build|null):Build {
 if(!candidate.character)throw Error(t('error.noCharacter'));
 const title=name.trim();if(!title||title.length>200)throw Error(t('error.characterName'));
 if(target&&!target.character)throw Error(t('error.characterOverGuide'));
 const output={...candidate,fileId:target?.fileId||candidate.fileId,character:{...candidate.character,name:title},title:title+' · '+candidate.character.source,shortTitle:title};
 if(new TextEncoder().encode(JSON.stringify(output)).length>MAX_FILE_BYTES)throw Error(t('error.characterTooBig'));
 return validate(portable(output));
}

/** The variants a panel lists. A panel no variant is meant for (Gear for a guide without gear) lists them all. */
export function characterProfileIndices(build:Build,type:string):number[]{
 const fit=build.stages.flatMap((s,i)=>!s.characterProfile||s.characterProfile==='active'||s.characterProfile===type?[i]:[]);
 return fit.length?fit:build.stages.map((_,i)=>i);
}
