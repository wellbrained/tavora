import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe,expect,it } from 'vitest';
import { MOBALYTICS_ADAPTER,parseMobalytics,prepareGuideSave } from './mobalytics-import';
import { keptVariant,matchVariants,variantChanges } from './guide-update';
import { portable, type Build } from './model';
import { validate } from './validate.js';

// Public guides captured 2026-10-22 with tools/mobalytics-fixture.mjs: real structure and game data, neutral placeholder prose.
const load=(slug:string)=>JSON.parse(gunzipSync(readFileSync(new URL(`../test/fixtures/mobalytics/${slug}.json.gz`,import.meta.url))).toString('utf8')) as {url:string;document:Record<string,unknown>};
const guides:[string,number,string[]][]=[
 ['ice-shot-deadeye',6,['Early','non-crit Midgame','non-crit Hybrid swap','Crit Hybrid','Uber Endgame','Live Gear']],
 ['immortal-witchhunter-frostbolt-infinite-loop',2,['Budget','Expensive']],
 ['ignite-whirling-slash-gemling',1,['Default']],
 ['martial-artist-league-starter-build',10,[]],
 ['scorps-plants-coc-endgame-guide-scorpius',6,[]],
 ['naviras-fracturing-varashta-league-starter',8,[]],
 ['fubgun-flameblast-oil-grenade',9,[]],
 ['deadrabbit-grenades-gemling-league-starter',7,['ACT 1','ACT 2','ACT 3/4','Interludes','Early Endgame','Mid Endgame','Uber Endgame']],
];
const parse=(slug:string,query='')=>{const f=load(slug);return parseMobalytics(f.document,f.url+query);};

describe.each(guides)('%s',(slug,count,labels)=>{
 it('imports every variant with its source ID, chapters and quest rewards',()=>{
  const b=parse(slug);
  expect(b.stages).toHaveLength(count);
  if(labels.length)expect(b.stages.map(s=>s.label)).toEqual(labels);
  expect(b.guideImport?.variantIds).toHaveLength(count);
  expect(new Set(b.guideImport?.variantIds).size).toBe(count);
  expect(b.guideText?.sections?.length).toBeGreaterThan(0);
  expect(b.questSelections?.length).toBeGreaterThan(0);
  expect(b.version).toBe('0.5.5');
  expect(b.importerVersion).toBe(`Mobalytics adapter ${MOBALYTICS_ADAPTER.version} · patch 0.5`);
  for(const s of b.stages){expect(s.passives.length).toBeGreaterThan(0);expect(s.skills.length).toBeGreaterThan(0);}
  expect(b.guideExport).toBeTruthy();
 });
});

it('names what the guide leaves open instead of guessing',()=>{
 const notes=parse('ice-shot-deadeye').importNotes!.join('\n');
 expect(notes).toMatch(/Attribute picks on \d+ passive nodes are saved but not shown yet\./);
 expect(notes).toMatch(/Jewels in \d+ tree sockets are saved but not shown yet\./);
 expect(parse('martial-artist-league-starter-build').importNotes!.join('\n')).toMatch(/\d+ soul cores and runes are saved/);
 expect(parse('ignite-whirling-slash-gemling').importNotes!.join('\n')).not.toMatch(/soul cores/);
});

it('opens the variant named in the URL by its source ID',()=>{
 const b=parse('ice-shot-deadeye'),ids=b.guideImport!.variantIds;
 expect(parse('ice-shot-deadeye',`?ws-ngf5-x=activeVariantId%2C${ids[3]}`).defaultStage).toBe(3);
});

describe('updating a saved guide',()=>{
 // Saved builds are stored in validated form, like the repository does.
 const saved=validate(portable(parse('ice-shot-deadeye')));
 // The site reorders variants, renames one, drops one and adds one; IDs decide, not positions.
 const reshaped=(b:Build):Build=>{
  const order=[4,0,2,3,1],ids=order.map(i=>b.guideImport!.variantIds[i]!),stages=order.map(i=>({...b.stages[i]!}));
  stages[1]={...stages[1]!,label:'Early (renamed)'};
  stages.push({...b.stages[5]!,label:'Brand new'});ids.push('new-uuid');
  stages[2]={...stages[2]!,passives:stages[2]!.passives.slice(1)};
  return {...b,stages,guideImport:{...b.guideImport!,variantIds:ids}};
 };
 const candidate=reshaped(saved);
 it('matches by source ID across reorders and renames',()=>{
  expect(matchVariants(saved,candidate)).toEqual(new Map([[4,0],[0,1],[2,2],[3,3],[1,4]]));
  expect(keptVariant(saved,candidate,3)).toBe(3);
  expect(keptVariant(saved,candidate,5)).toBeUndefined();
 });
 it('finds nothing new in a fresh import of the same guide',()=>{
  expect(variantChanges(saved,parse('ice-shot-deadeye'))).toEqual({added:[],removed:[],changed:[],same:6});
 });
 it('lists new, changed and removed variants',()=>{
  expect(variantChanges(saved,candidate)).toEqual({added:['Brand new'],removed:['Live Gear'],changed:['Early (renamed)','non-crit Hybrid swap'],same:3});
 });
 it('falls back to the exact name when a source gives no IDs',()=>{
  const noIds=(b:Build):Build=>({...b,guideImport:{...b.guideImport!,variantIds:[]}});
  const flipped={...noIds(saved),stages:[...saved.stages].reverse()};
  expect(keptVariant(noIds(saved),flipped,0)).toBe(5);
 });
 it('reads an exported file back as the same build',()=>{
  // Export writes portable(build) as indented JSON; Load build file validates it again.
  const file=JSON.stringify(portable(saved),null,2);
  expect(validate(JSON.parse(file))).toEqual(saved);
 });
 it('keeps the saved file identity',()=>{
  expect(prepareGuideSave(candidate,'Ice Shot',{...saved,fileId:'saved-file'}).fileId).toBe('saved-file');
 });
});
