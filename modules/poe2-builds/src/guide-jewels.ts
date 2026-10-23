import modTexts from './mod-texts.json';
import uniqueReferences from './unique-references.json';
import { cleanGameText } from './pob-import';
import type { Item } from './model';

type Obj = Record<string, unknown>;
const obj = (v:unknown):Obj => v && typeof v==='object' && !Array.isArray(v) ? v as Obj : {};
const str = (v:unknown):string => typeof v==='string' ? v : '';
const texts = modTexts as Record<string,string[]>;
const references = uniqueReferences as Record<string,{base:string;implicit:string[];explicit:string[]}>;
/** Mobalytics' rare jewel slugs name the base by its attribute; radius jewels are the Time-Lost ones. */
const bases: Record<string,string> = {jewelstr:'Ruby',jeweldex:'Emerald',jewelint:'Sapphire',jewelprismatic:'Diamond',jewelradiusstr:'Time-Lost Ruby',jewelradiusdex:'Time-Lost Emerald',jewelradiusint:'Time-Lost Sapphire',jewelradiusprismatic:'Time-Lost Diamond'};
const small = new Set(['a','an','and','for','in','of','on','the','to']);

/** The unique's name from the guide's trade search, else from its slug: jewel-fouruniquejewel12-heart-of-the-well. */
function uniqueName(source:Obj):string {
 try { const name=obj(obj(JSON.parse(str(obj(source.poe2TradeRequest).query))).query).name; if(typeof name==='string'&&name.trim())return cleanGameText(name.trim()); } catch { /* The slug names it too. */ }
 const words=str(source.jewelSlug).replace(/^jewel-/,'').replace(/^fouruniquejewel\d+-/,'').split('-').filter(Boolean);
 return words.map((w,i)=>i&&small.has(w)?w:w[0]!.toUpperCase()+w.slice(1)).join(' ');
}

/** One jewel of a Mobalytics variant's tree. The guide never gives rolls: rare mods come from their game mod IDs
 * as PoB ranges, uniques from PoB's reference ranges. Whatever doesn't resolve is marked missing, never guessed. */
export function guideJewel(source:Obj, index:number):Item|null {
 const slug=str(source.jewelSlug);if(!slug)return null;
 const node=/^node-(\d+)$/.exec(str(source.nodeSlug))?.[1];
 const slugs=(key:string)=>(Array.isArray(source[key])?source[key] as unknown[]:[]).map(str).filter(Boolean);
 const prefixes=slugs('prefixSlugs'),suffixes=slugs('suffixSlugs');
 const item:Item={inventory_id:'Jewel',slot_x:index,name:'',mods:[],...(node?{node}:{}),
  sourceModifiers:[...prefixes.map(id=>({kind:'prefix',id,stats:{}})),...suffixes.map(id=>({kind:'suffix',id,stats:{}}))]};
 if(source.isUnique===true){
  const name=uniqueName(source),reference=Object.hasOwn(references,name)?references[name]:undefined;
  // PoB lists Corrupted among a unique's lines; it isn't a mod.
  const lines=(list:string[]=[])=>list.filter(l=>l!=='Corrupted');
  const implicit=lines(reference?.implicit),explicit=lines(reference?.explicit),mods=[...implicit,...explicit];
  const corrupted=!!reference&&[...reference.implicit,...reference.explicit].includes('Corrupted');
  return {...item,name,base:reference?.base||'',rarity:'unique',mods,sourceSections:[{kind:'implicitMods',mods:implicit},{kind:'explicitMods',mods:explicit}].filter(s=>s.mods.length),
   ...(mods.length?{reference:true}:{modsMissing:true}),...(corrupted?{corrupted:true}:{})};
 }
 const found=[...prefixes,...suffixes].map(id=>Object.hasOwn(texts,id)?texts[id]!.slice(1):undefined);
 const mods=found.flatMap(m=>m||[]),base=bases[slug.replace(/^jewel-/,'')]||'Jewel';
 return {...item,name:base,base,mods,sourceSections:mods.length?[{kind:'explicitMods',mods}]:[],
  ...(mods.length?{reference:true}:{}),...(!found.length||found.some(m=>!m)?{modsMissing:true}:{})};
}

export function guideJewels(list:unknown):Item[] {
 return (Array.isArray(list)?list:[]).slice(0,100).map(obj).map((j,i)=>guideJewel(j,i)).filter((j):j is Item=>!!j).map((j,i)=>({...j,slot_x:i}));
}
