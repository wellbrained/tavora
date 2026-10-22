import type { TavoraSDK } from '@tavora/sdk';
import { decompress } from 'brotli/decompress';
import lookup from './character-data.json';
import trees from './trees.json';
import gemTables from './poevault-gems.json';
import { portable, type Build, type Gem, type Guide, type GuideSection, type Stage } from './model';
import { validate } from './validate.js';
import type { GuideImport } from './mobalytics-import';

type Obj = Record<string, unknown>;
const obj = (v:unknown):Obj => v && typeof v==='object' && !Array.isArray(v) ? v as Obj : {};
const arr = (v:unknown):unknown[] => Array.isArray(v) ? v : [];
const str = (v:unknown):string => typeof v==='string' ? v : '';
/** Raise version when the mapping changes; patches lists the game versions the bundled tree supports. */
export const POEVAULT_ADAPTER={source:'PoE Vault',version:'1',patches:['0.5']} as const;
const ORIGIN='https://www.poe-vault.com';

export function poeVaultAddress(input:string):{url:string;canonical:string} {
 let u:URL;try{u=new URL(input.trim());}catch{throw Error('Paste a PoE Vault PoE 2 guide URL.');}
 if(u.protocol!=='https:'||!['www.poe-vault.com','poe-vault.com'].includes(u.hostname)||u.port||u.username||u.password||!/^\/poe2\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+\/?$/.test(u.pathname))throw Error('Choose a build guide at poe-vault.com/poe2.');
 const canonical=ORIGIN+u.pathname.replace(/\/$/,'');
 return {url:canonical,canonical};
}

/** What a guide page holds: its prose and the planners it embeds. */
export interface VaultPage { title:string; modified:string; sections:GuideSection[]; trees:string[]; skills:{version:string;hash:string}[]; oldTrees:number }

const ENTITIES:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',ndash:'–',mdash:'—',lsquo:'‘',rsquo:'’',ldquo:'“',rdquo:'”',hellip:'…',times:'×'};
const decode=(s:string)=>s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(m,e:string)=>{
 if(e[0]==='#'){const n=e[1]==='x'||e[1]==='X'?parseInt(e.slice(2),16):Number(e.slice(1));return n>0&&n<=0x10ffff?String.fromCodePoint(n):m;}
 return ENTITIES[e.toLowerCase()]??m;
});
const attribute=(attrs:string,name:string)=>{const m=new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,'i').exec(attrs);return m?decode(m[1]??m[2]??''):'';};

/** Next.js streams page data in script chunks; a planner link can be split across two of them. Read as JSON, never run. */
export function pageData(html:string):string {
 let data='';
 for(const m of html.matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g)){try{const record=JSON.parse(m[1]!);if(typeof record[1]==='string')data+=record[1];}catch{/* Not a data chunk. */}}
 return data;
}

const SKIP=new Set(['script','style','svg','noscript','iframe','button','template','select','canvas','video','audio','form','picture','textarea']);
const VOID=new Set(['area','base','br','col','embed','hr','img','input','link','meta','source','track','wbr']);
const BREAK=new Set(['p','div','li','tr','ul','ol','table','blockquote','figcaption','section','dt','dd','br','hr']);
/** The article's own words, split into chapters at its headings. Embedded planners and the page header are left out. */
export function articleSections(html:string, base:string):GuideSection[] {
 const start=html.search(/<div[^>]*class="ArticleContent_article_content/),end=html.indexOf('</article>',start);
 if(start<0)return [];
 const sections:GuideSection[]=[];let title='Overview',body='';
 const skipped:string[]=[],links:{href:string;at:number}[]=[];let heading:string|null=null;
 const flush=()=>{const text=body.replace(/[ \t]+/g,' ').replace(/ ?\n ?/g,'\n').replace(/\n{3,}/g,'\n\n').trim();if(text)sections.push({title,text,context:context(title)});body='';};
 for(const m of html.slice(start,end<0?undefined:end).matchAll(/<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/g)){
  if(m[4]!==undefined){if(!skipped.length){const t=decode(m[4]).replace(/\s+/g,' ');if(heading!==null)heading+=t;else body+=t;}continue;}
  if(!m[2])continue;
  const name=m[2].toLowerCase(),closing=!!m[1],attrs=m[3]||'',selfClosing=VOID.has(name)||/\/\s*$/.test(attrs);
  if(skipped.length){if(name===skipped.at(-1)&&!selfClosing){if(closing)skipped.pop();else skipped.push(name);}continue;}
  if(!closing&&!selfClosing&&(SKIP.has(name)||/^PoeTwo/.test(attribute(attrs,'class')))){skipped.push(name);continue;}
  if(/^h[1-6]$/.test(name)){
   if(!closing){flush();heading='';}
   else if(heading!==null){title=heading.trim()||title;heading=null;}
   continue;
  }
  if(name==='a'){
   if(!closing){links.push({href:attribute(attrs,'href'),at:body.length});continue;}
   const link=links.pop();if(!link||heading!==null)continue;
   try{const u=new URL(link.href,base);const label=body.slice(link.at);if(['https:','http:'].includes(u.protocol)&&!u.username&&!u.password&&label.trim()&&!label.includes(u.href))body+=` (${u.href})`;}catch{/* Keep the label. */}
   continue;
  }
  if(heading!==null)continue;
  if(!closing&&name==='li')body+='\n• ';
  else if(!closing&&(name==='td'||name==='th')&&!/\n\s*$/.test(body))body+=' · ';
  else if(BREAK.has(name))body+=name==='p'&&closing?'\n\n':'\n';
 }
 flush();
 return sections;
}
function context(title:string):string {
 if(/tree|passive|ascendanc/i.test(title))return 'tree';
 if(/gem|skill|rotation/i.test(title))return 'skills';
 if(/gear|item|jewel|flask|charm|rune|augment|unique|equipment/i.test(title))return 'gear';
 return 'overview';
}

export function vaultPage(html:string, url:string):VaultPage {
 if(html.length>5*1024*1024)throw Error('The guide page exceeds 5 MB.');
 const title=decode((/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1]||'').replace(/<[^>]+>/g,'')).replace(/\s+/g,' ').trim();
 if(!title)throw Error('This page does not look like a PoE Vault guide. Attach a build file instead.');
 const page:VaultPage={title,modified:/"dateModified":"([^"]{1,40})"/.exec(html)?.[1]||'',sections:articleSections(html,url),trees:[],skills:[],oldTrees:0};
 for(const m of pageData(html).matchAll(/"embedUrl":"((?:[^"\\]|\\.)*)"/g)){
  let u:URL;try{u=new URL(JSON.parse(`"${m[1]}"`));}catch{continue;}
  if(u.origin!==ORIGIN)continue;
  if(u.pathname==='/poe2/tools/passive-tree'){
   const uid=u.searchParams.getAll('uid').at(-1)||'';
   if(/^[A-Za-z0-9_-]{6,40}$/.test(uid)){if(!page.trees.includes(uid))page.trees.push(uid);}
   else if(u.searchParams.has('hash'))page.oldTrees++;
  }else if(u.pathname==='/poe2/tools/skill-planner'){
   // URLSearchParams reads a raw + as a space; base64 needs it back.
   const hash=(u.searchParams.get('hash')||'').replace(/ /g,'+'),version=u.searchParams.get('ver')||'';
   if(hash&&!page.skills.some(s=>s.hash===hash))page.skills.push({version,hash});
  }
 }
 return page;
}

/** The skill planner keeps its setups as Brotli-compressed JSON in the link. */
export function gemSetups(hash:string):{name:string;slots:unknown[][]}[] {
 let bytes:Uint8Array;try{bytes=Uint8Array.from(atob(hash),c=>c.charCodeAt(0));}catch{throw Error('A gem planner link in this guide is damaged.');}
 let setups:unknown;try{setups=JSON.parse(new TextDecoder().decode(decompress(bytes)));}catch{throw Error('A gem planner link in this guide could not be read.');}
 return arr(setups).map(obj).filter(s=>str(s.name)&&Array.isArray(s.slots)).map(s=>({name:str(s.name),slots:arr(s.slots).filter(Array.isArray) as unknown[][]}));
}

type KnownGem={id:string;name:string;gameId?:string;tier:number;attributes:string[];support:boolean;tags:string[]};
const knownGems=Object.entries(lookup.gems as Record<string,Omit<KnownGem,'id'>>).map(([id,g])=>({id,...g}));
const gemsById=new Map(knownGems.flatMap(g=>[[g.id,g],...(g.gameId?[[g.gameId,g]]:[])] as [string,KnownGem][]));
const gemsByName=new Map<string,KnownGem[]>();for(const g of knownGems)gemsByName.set(g.name,[...gemsByName.get(g.name)||[],g]);
const requirement=[1,3,6,10,14,18,22,26,31,36,41,46,52,58,64,66,72,78,84,90];
/** Gem numbers mean different gems in different planner versions; an unknown number stays out rather than being guessed.
 * The planner's game IDs don't always match the game files, so the exact name and kind are the fallback. */
function vaultGem(value:unknown, table:Record<string,[string,string,number]>):Gem|null {
 const source=typeof value==='number'?{id:value}:obj(value),entry=table[String(source.id)];
 if(!entry)return null;
 const [base,id,kind]=entry,gameId=id&&!id.includes('/')?'Metadata/Items/Gems/'+id:id,chosen=str(source.name);
 const known=gemsById.get(gameId)||gemsByName.get(base)?.find(g=>g.support===(kind===1));
 const name=chosen?base.includes('{0}')?base.replace('{0}',chosen):`${base}: ${chosen}`:base;
 return {id:known?.gameId||known?.id||gameId||name,name,attributes:known?.attributes||[],isSupport:known?.support??kind===1,tags:known?.tags||[],...(known&&!known.support&&known.tier>0?{levels:[requirement[known.tier-1]||1]}:{})};
}

/** savedTrees: the planner's answers (build objects) for page.trees, in the same order. */
export function parsePoeVault(page:VaultPage, savedTrees:Obj[], input:string):Build {
 const address=poeVaultAddress(input),nodes=trees['0.5'] as {id:string;ascendancy:string|null}[];
 const versions=savedTrees.map(t=>str(t.version)).filter(Boolean);
 for(const v of versions)if(!POEVAULT_ADAPTER.patches.some(p=>v===p||v.startsWith(p+'.')))throw Error('This guide uses a game version not supported by the bundled 0.5 tree. Your saved build was not changed.');
 const treeSetups=savedTrees.flatMap(t=>arr(t.build).map(obj).map(setup=>{
  const passives:Stage['passives']=[];
  for(const n of arr(setup.activeNodes).map(obj)){const id=str(n.id),weapon=[0,1,2].includes(n.weaponSet as number)?n.weaponSet as number:0;if(/^\d+$/.test(id)&&!passives.some(p=>p.id===id&&p.weapon===weapon))passives.push({id,weapon});}
  const ascendancy=nodes.find(n=>n.ascendancy&&passives.some(p=>p.id===n.id))?.ascendancy||str(t.ascendancyName);
  const attributes=new Set(arr(setup.history).map(obj).filter(h=>h.action==='activated'&&str(h.selectedAttribute)).map(h=>str(h.nodeId)));
  return {name:str(setup.name)||'Passive tree',passives,ascendancy,attributes};
 }));
 let unknownGems=0;const unreadable=new Set<string>(),older=new Set<string>();
 const skillSetups=page.skills.flatMap(planner=>{
  const table=(gemTables as unknown as {versions:string[];gems:Record<string,[string,string,number]>}[]).find(t=>t.versions.includes(planner.version))?.gems;
  if(!table){unreadable.add(planner.version||'unknown');return [];}
  if(!planner.version.startsWith('0.5'))older.add(planner.version);
  return gemSetups(planner.hash).map(setup=>({name:setup.name,skills:setup.slots.flatMap(slot=>{
   const gems=slot.map(g=>{const gem=vaultGem(g,table);if(!gem)unknownGems++;return gem;});
   const [active,...supports]=gems;if(!active)return [];
   return [{...active,supports:supports.filter((g):g is Gem=>!!g)}];
  })}));
 });
 // A tree and a gem setup are one variant only when the guide gives them the same name.
 const used=new Set<number>(),stages:Stage[]=[];
 for(const t of treeSetups){
  const j=skillSetups.findIndex((s,k)=>!used.has(k)&&s.name===t.name);if(j>=0)used.add(j);
  stages.push({name:t.name,label:t.name,author:'',link:address.canonical,ascendancy:t.ascendancy,items:[],skills:j>=0?skillSetups[j]!.skills:[],passives:t.passives,...(j<0?{characterProfile:'tree' as const}:{})});
 }
 skillSetups.forEach((s,k)=>{if(!used.has(k))stages.push({name:s.name,label:s.name,author:'',link:address.canonical,items:[],skills:s.skills,passives:[],characterProfile:'skills'});});
 if(!stages.length)throw Error('This guide has no passive tree or gem planner Tavora can read. Attach a build file instead.');
 if(stages.length>50)throw Error('This guide has more setups than Tavora can show.');
 // Variant names are the only identity PoE Vault gives; repeats get a number so updates can still match them.
 const seen=new Map<string,number>();
 for(const s of stages){const n=(seen.get(s.label)||0)+1;seen.set(s.label,n);if(n>1)s.name=s.label=`${s.label} (${n})`;}
 const guide:Guide={url:address.canonical,sections:page.sections,items:{},gems:{}};
 for(const key of ['tree','skills','gear'] as const){const first=page.sections.find(s=>s.context===key);if(first)guide[key]=first.text.split(/\n\s*\n/)[0]||first.text;}
 const attributes=new Set(treeSetups.flatMap(t=>[...t.attributes])).size,unpaired=stages.some(s=>s.characterProfile==='tree')&&stages.some(s=>s.characterProfile==='skills');
 const b:Build={id:'imported',fileId:crypto.randomUUID(),title:page.title+' · PoE Vault',shortTitle:page.title,source:'PoE Vault',version:versions[0]||page.skills[0]?.version||'',treeVersion:'0.5',ascendancy:stages.find(s=>s.ascendancy)?.ascendancy||'',guideUrl:address.canonical,guideText:guide.sections!.length?guide:null,stages,defaultStage:0,
  guideImport:{source:'PoE Vault',url:address.url,documentId:new URL(address.canonical).pathname,revision:page.modified,importedAt:new Date().toISOString(),variantIds:stages.map(s=>s.label)},
  guideExport:JSON.stringify({url:address.canonical,modified:page.modified,trees:savedTrees,skills:page.skills}),
  importerVersion:`${POEVAULT_ADAPTER.source} adapter ${POEVAULT_ADAPTER.version} · patch ${POEVAULT_ADAPTER.patches.join(', ')}`,
  importNotes:[
   'PoE Vault guides have no gear planner, so gear stays empty. The guide text covers it.',
   ...(unpaired?['The guide doesn\'t pair its passive trees with its gem setups, so Tree and Skills each list their own.']:[]),
   ...(attributes?[`Attribute picks on ${attributes} passive nodes are saved but not shown yet.`]:[]),
   ...(older.size?[`Gem setups from the patch ${[...older].join(', ')} planner are shown as the guide lists them.`]:[]),
   ...(unreadable.size?[`Gem setups from planner version ${[...unreadable].join(', ')} can't be read yet and were left out.`]:[]),
   ...(unknownGems?[`${unknownGems} gems in the planner aren't in Tavora's data and were left out.`]:[]),
   ...(page.oldTrees?[`${page.oldTrees} passive tree${page.oldTrees===1?' uses':'s use'} an older planner link and ${page.oldTrees===1?'was':'were'} left out.`]:[]),
  ]};
 return validate(portable(b));
}

/** The public planner loads saved trees through a Next.js server action. Its ID changes with each site release, so read it from the planner's own scripts. */
let cachedAction='';
async function treeAction(network:TavoraSDK['network'], uid:string):Promise<string> {
 if(cachedAction)return cachedAction;
 const tool=await network.fetch(`${ORIGIN}/poe2/tools/passive-tree?protocol=1&uid=${encodeURIComponent(uid)}`);
 if(tool.status<200||tool.status>=300)throw Error(`PoE Vault's tree planner didn't answer (HTTP ${tool.status}). Try again later.`);
 const scripts=[...new Set([...tool.body.matchAll(/<script[^>]+src="(\/poe2\/_next\/static\/chunks\/[\w./()[\]-]+\.js)"/g)].map(m=>m[1]!))].slice(0,40);
 for(const src of scripts){
  const code=await network.fetch(ORIGIN+src);
  const action=/createServerReference\)\("([a-f0-9]{20,64})"[^;]{0,200}?"loadPassiveTreeBuild"/.exec(code.body)?.[1];
  if(action)return cachedAction=action;
 }
 throw Error('PoE Vault changed its tree planner. Update the module, or attach a build file.');
}
export function treeAnswer(body:string):Obj {
 for(const line of body.split('\n')){
  const at=line.indexOf(':');if(at<1||!/^\w+$/.test(line.slice(0,at)))continue;
  let value:unknown;try{value=JSON.parse(line.slice(at+1));}catch{continue;}
  const answer=obj(value);if(answer.success===true&&Array.isArray(obj(answer.build).build))return obj(answer.build);
 }
 throw Error('A passive tree in this guide could not be loaded.');
}
async function loadTree(network:TavoraSDK['network'], uid:string, retry=true):Promise<Obj> {
 const action=await treeAction(network,uid);
 const response=await network.fetch(`${ORIGIN}/poe2/tools/passive-tree?protocol=1&uid=${encodeURIComponent(uid)}`,{method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8','Accept':'text/x-component','Next-Action':action},body:JSON.stringify([uid])});
 try{if(response.status<200||response.status>=300)throw Error();return treeAnswer(response.body);}
 catch{if(!retry)throw Error('A passive tree in this guide could not be loaded.');cachedAction='';return loadTree(network,uid,false);}
}

export async function importPoeVault(input:string, network:TavoraSDK['network']):Promise<GuideImport> {
 const address=poeVaultAddress(input),response=await network.fetch(address.url);
 if(response.status===404)throw Error('PoE Vault has no guide at this address.');
 if(response.status<200||response.status>=300)throw Error(`PoE Vault didn't answer (HTTP ${response.status}). Try again later.`);
 const page=vaultPage(response.body,address.url),savedTrees:Obj[]=[];
 for(const uid of page.trees.slice(0,10))savedTrees.push(await loadTree(network,uid));
 const build=parsePoeVault(page,savedTrees,address.url);
 return {build,method:'direct',warnings:build.importNotes||[]};
}
