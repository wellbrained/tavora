import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe,expect,it } from 'vitest';
import lookup from './character-data.json';
import trees from './trees.json';
import { POEVAULT_ADAPTER,gemSetups,importPoeVault,parsePoeVault,poeVaultAddress,treeAnswer,vaultPage } from './poevault-import';
import { guideAddress } from './guide-sources';
import { characterProfileIndices } from './character-import';
import { prepareGuideSave } from './mobalytics-import';
import { keptVariant,variantChanges } from './guide-update';
import { portable, type Build } from './model';
import { validate } from './validate.js';

// Public guides captured 2026-10-22 with tools/poevault-fixture.mjs: real planner data and page structure, neutral placeholder prose.
type Fixture={url:string;html:string;trees:Record<string,unknown>[]};
const load=(slug:string)=>JSON.parse(gunzipSync(readFileSync(new URL(`../test/fixtures/poevault/${slug}.json.gz`,import.meta.url))).toString('utf8')) as Fixture;
const parse=(slug:string)=>{const f=load(slug);return parsePoeVault(vaultPage(f.html,f.url),f.trees,f.url);};
const shape=(b:Build)=>b.stages.map(s=>`${s.label}:${s.characterProfile||'both'}`);
const guides:[string,string[]][]=[
 ['infernal-legion-tamed-beast-build-guide',['Hollowpalm Earlygame:both','Infernal II Midgame:both',"Catha's Endgame:both"]],
 ['lightning-warp-build-guide',['Starter Setup:both','Final Setup:both']],
 ['companion-leveling-build',['Act 1 - 3 Twisters:tree','Companion Swap:tree','Companion Until 70:tree','Act 1:skills','Act 2:skills','Act 3 before swap:skills','Act 3:skills','Act 4 and Beyond:skills']],
 ['chaos-leveling-build',['Leveling Tree:tree','Act 1:skills','Act 2:skills','Act 3:skills','Act 4:skills']],
 ['totems-build-guide',['Tree 1:tree','Tree 1 (2):tree','Endgame Setup:skills','Endgame Setup (2):skills','Endgame Setup (3):skills']],
 ['poison-build-guide',['Endgame:skills']],
 ['spark-comet-stormweaver-mana-stacking-endgame-build',['Tree 1:tree','Endgame:skills']],
 ['rarity-culling-build-guide',['Tree 1:tree','Tree 2:tree','Tree 3:tree','Rarity Cull Bot:skills']],
 ['chaos-flicker-strike-build-guide',['Tree 1:tree','Main Skills:skills']],
];
const nodes=new Set((trees['0.5'] as {id:string}[]).map(n=>n.id));
const known=new Set(Object.entries(lookup.gems as Record<string,{gameId?:string}>).flatMap(([id,g])=>[id,g.gameId||id]));

describe.each(guides)('%s',(slug,variants)=>{
 it('imports every tree and gem setup, paired only by the same name',()=>{
  const b=parse(slug);
  expect(shape(b)).toEqual(variants);
  expect(b.guideImport?.variantIds).toEqual(b.stages.map(s=>s.label));
  expect(b.importerVersion).toBe(`PoE Vault adapter ${POEVAULT_ADAPTER.version} · patch 0.5`);
  expect(b.guideText?.sections?.length).toBeGreaterThan(5);
  expect(b.guideText?.sections?.every(s=>s.text.trim()&&!/Fetching data|0 \/ \d+/.test(s.text))).toBe(true);
  for(const s of b.stages){
   expect(s.items).toEqual([]);
   if(s.characterProfile!=='skills')expect(s.passives.length).toBeGreaterThan(40);
   if(s.characterProfile!=='tree')expect(s.skills.length).toBeGreaterThan(0);
  }
  expect(b.importNotes![0]).toMatch(/no gear planner/);
  expect(JSON.parse(b.guideExport!).url).toBe(load(slug).url);
 });
});

it('places every allocated node on the bundled 0.5 tree, including a 0.5.5 planner',()=>{
 for(const [slug] of guides)for(const s of parse(slug).stages)expect(s.passives.filter(p=>!nodes.has(p.id))).toEqual([]);
 expect(parse('spark-comet-stormweaver-mana-stacking-endgame-build').version).toBe('0.5.5.4');
});

it('resolves 0.5 gems against the bundled game data and names companions',()=>{
 const b=parse('infernal-legion-tamed-beast-build-guide');
 const gems=b.stages.flatMap(s=>s.skills.flatMap(g=>[g,...g.supports||[]]));
 expect(gems.filter(g=>!known.has(g.id)).map(g=>g.name)).toEqual([]);
 expect(gems.map(g=>g.name)).toContain('Companion: Plague Harvester');
 expect(b.stages[2]!.skills[0]!.supports!.every(g=>g.isSupport)).toBe(true);
});

it('says what it leaves out instead of guessing',()=>{
 expect(parse('infernal-legion-tamed-beast-build-guide').importNotes!.join('\n')).toMatch(/Attribute picks on \d+ passive nodes are saved but not shown yet\./);
 expect(parse('infernal-legion-tamed-beast-build-guide').importNotes!.join('\n')).not.toMatch(/pair|older|left out/);
 expect(parse('chaos-leveling-build').importNotes!.join('\n')).toMatch(/patch 0\.4\.0 planner are shown as the guide lists them/);
 const poison=parse('poison-build-guide').importNotes!.join('\n');
 expect(poison).toMatch(/1 passive tree uses an older planner link and was left out/);
 expect(poison).not.toMatch(/pair/);
 expect(parse('totems-build-guide').importNotes!.join('\n')).toMatch(/Tree and Skills each list their own/);
});

it('lists tree and skills variants only in their own panels; Gear lists all when none has gear',()=>{
 const b=validate(portable(parse('chaos-leveling-build')));
 expect(characterProfileIndices(b,'tree')).toEqual([0]);
 expect(characterProfileIndices(b,'skills')).toEqual([1,2,3,4]);
 expect(characterProfileIndices(b,'gear')).toEqual([0,1,2,3,4]);
 const paired=validate(portable(parse('lightning-warp-build-guide')));
 for(const panel of ['tree','skills','gear'])expect(characterProfileIndices(paired,panel)).toEqual([0,1]);
});

it('keeps the article as chapters with the guide\'s headings and inline game names',()=>{
 const sections=parse('infernal-legion-tamed-beast-build-guide').guideText!.sections!;
 expect(sections.map(s=>s.title)).toEqual(expect.arrayContaining(['Overview','Strengths and Weaknesses','Skill Tree','Gem Info','Changelog']));
 expect(sections.find(s=>s.title==='Skill Tree')?.context).toBe('tree');
 expect(sections.find(s=>s.title==='Gem Info')?.context).toBe('skills');
 expect(sections.map(s=>s.text).join('\n')).toContain('Oil Grenade');
});

describe('updating a saved guide',()=>{
 const saved=validate(portable(parse('companion-leveling-build')));
 it('finds nothing new in a fresh import of the same guide',()=>{
  expect(variantChanges(saved,parse('companion-leveling-build'))).toEqual({added:[],removed:[],changed:[],same:8});
 });
 it('matches setups by name when the guide reorders, renames or drops them',()=>{
  const fresh=parse('companion-leveling-build');
  const stages=[fresh.stages[4]!,{...fresh.stages[3]!,label:'Act 1 (new)',name:'Act 1 (new)'},...fresh.stages.slice(0,3),...fresh.stages.slice(5,7)];
  const candidate={...fresh,stages,guideImport:{...fresh.guideImport!,variantIds:stages.map(s=>s.label)}};
  expect(variantChanges(saved,candidate)).toEqual({added:['Act 1 (new)'],removed:['Act 1','Act 4 and Beyond'],changed:[],same:6});
  expect(keptVariant(saved,candidate,4)).toBe(0);
 });
 it('keeps the saved file identity and refuses another guide',()=>{
  const next=prepareGuideSave(parse('companion-leveling-build'),'Companion',saved);
  expect(next.fileId).toBe(saved.fileId);
  expect(next.title).toBe('Companion · PoE Vault');
  expect(()=>prepareGuideSave(parse('chaos-leveling-build'),'Other',saved)).toThrow(/different guide/);
 });
});

it('accepts only PoE Vault PoE 2 guide addresses',()=>{
 expect(poeVaultAddress('https://poe-vault.com/poe2/witch/lich/chaos-leveling-build/?x=1#top').canonical).toBe('https://www.poe-vault.com/poe2/witch/lich/chaos-leveling-build');
 for(const bad of ['http://www.poe-vault.com/poe2/witch/lich/x','https://www.poe-vault.com.evil.test/poe2/witch/lich/x','https://user@www.poe-vault.com/poe2/witch/lich/x','https://www.poe-vault.com:444/poe2/witch/lich/x','https://www.poe-vault.com/poe2/tools/passive-tree','https://www.poe-vault.com/poe/witch/lich/x'])expect(()=>poeVaultAddress(bad)).toThrow();
 expect(()=>guideAddress('https://maxroll.gg/poe2/build-guides/x')).toThrow('Paste a guide from Mobalytics or PoE Vault.');
 expect(guideAddress('https://www.poe-vault.com/poe2/witch/lich/chaos-leveling-build').canonical).toContain('poe-vault');
 expect(guideAddress('https://mobalytics.gg/poe-2/builds/ice-shot-deadeye').canonical).toContain('mobalytics');
});

it('reads planner links split across page data chunks and decodes Brotli gem links',()=>{
 const page=vaultPage(load('companion-leveling-build').html,load('companion-leveling-build').url);
 expect(page.trees).toEqual(['iYGquQ2hqqQZ']);
 expect(page.skills).toHaveLength(2);
 expect(gemSetups(page.skills[0]!.hash).map(s=>s.name)).toEqual(['Act 1','Act 2','Act 3 before swap']);
 expect(()=>gemSetups('not base64!')).toThrow(/damaged/);
});

it('reads the planner answer, and refuses unexpected answers',()=>{
 const build={uid:'x',version:'0.5.2.1',build:[{name:'A',activeNodes:[]}]};
 expect(treeAnswer(`0:{"a":"$@1"}\n1:${JSON.stringify({success:true,build})}\n`)).toEqual(build);
 expect(()=>treeAnswer('0:{"a":"$@1"}\n1:{"success":false}')).toThrow(/could not be loaded/);
 expect(()=>treeAnswer('<html>Error</html>')).toThrow();
});

it('fetches the page, finds the read action in the planner scripts and loads each tree',async()=>{
 const f=load('lightning-warp-build-guide'),calls:{url:string;method:string}[]=[];
 const action='40384560a143b1a721fa0ef00fad52a08449f9e91e';
 const network={readPage:async()=>{throw Error('not used');},fetch:async(url:string,init:{method?:string;headers?:Record<string,string>;body?:string}={})=>{
  calls.push({url,method:init.method||'GET'});
  if(url===f.url)return {url,status:200,headers:{},body:f.html};
  if(init.method==='POST'){expect(init.headers?.['Next-Action']).toBe(action);return {url,status:200,headers:{},body:`0:{}\n1:${JSON.stringify({success:true,build:f.trees[0]})}`};}
  if(url.includes('/tools/passive-tree'))return {url,status:200,headers:{},body:'<script src="/poe2/_next/static/chunks/1-a.js"></script><script src="/poe2/_next/static/chunks/886-b.js"></script>'};
  if(url.endsWith('886-b.js'))return {url,status:200,headers:{},body:`K=(0,G.createServerReference)("${action}",G.callServer,void 0,G.findSourceMapURL,"loadPassiveTreeBuild")`};
  return {url,status:200,headers:{},body:'// other chunk'};
 }};
 const result=await importPoeVault(f.url,network as never);
 expect(result.method).toBe('direct');
 expect(shape(result.build)).toEqual(['Starter Setup:both','Final Setup:both']);
 expect(calls.every(c=>new URL(c.url).origin==='https://www.poe-vault.com')).toBe(true);
 expect(calls.filter(c=>c.method==='POST')).toHaveLength(1);
 await expect(importPoeVault(f.url,{...network,fetch:async(url:string)=>({url,status:404,headers:{},body:''})} as never)).rejects.toThrow('PoE Vault has no guide at this address.');
});
