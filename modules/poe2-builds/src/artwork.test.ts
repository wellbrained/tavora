import { expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { gemArtwork, gemImage } from './gem-art';
import { treeArtwork } from './tree-art';
import catalog from './gem-art.json';
import treeCatalog from './tree-art.json';
import trees from './trees.json';
import { restoreView } from './view-state';
import { skillCard } from './presentation';
import type { Gem } from './model';
const gem = (name: string, isSupport = false): Gem => ({name,id:'',isSupport,attributes:['Dexterity']});

it('resolves real active, support and nested gem art, with safe unknown fallback', () => {
 for (const g of [gem('Ice Shot'), gem('Fork', true), gem("Garukhan's Resolve",true)]) expect(gemArtwork(g)).not.toBeNull();
 expect(gemArtwork({...gem(''),id:'Metadata/Items/Gem/SkillGemIceShot'})).toEqual(gemArtwork(gem('Ice Shot')));
 expect(gemArtwork(gem('https://example.com/unknown.png'))).toBeNull();
 expect(gemImage(gem('Unknown'))).toContain('gem-mark gem-dexterity');
 expect(gemImage(gem('Unknown'))).not.toContain('url(');
 const markup=skillCard({...gem('Ice Shot'),level:20,supports:[{...gem('Fork',true),level:2,lineage:true},gem('Snipe')]},'');
 expect(markup.match(/gem-art/g)).toHaveLength(3);
 expect(markup).toContain('Gem level 20'); expect(markup).toContain('support-level'); expect(markup).toContain('lineage-support');
});

it('all gem coordinates fit the bundled sheets',()=>{
 for (const entry of [...Object.values(catalog.active),...Object.values(catalog.gems)]) {
  const [sheet,x,y]=entry;expect(sheet).toBeLessThan(2);expect(x).toBeGreaterThanOrEqual(0);expect(x).toBeLessThan(32);expect(y).toBeGreaterThanOrEqual(0);expect(y).toBeLessThan(32);
  expect(existsSync(new URL(`../public/assets/gems/gems-${sheet}.webp`,import.meta.url))).toBe(true);
 }
});

it('uses version-specific native illustration centres and bundles every mapped image',()=>{
 for(const [version,entries] of Object.entries(treeCatalog))for(const [name,entry] of Object.entries(entries)){
  expect(existsSync(new URL('../public/assets/classes/'+entry.file,import.meta.url))).toBe(true);
  expect(treeArtwork(version,name,false)?.className).toBe(entry.className);
  const nodes=(trees as Record<string,{x:number;y:number;ascendancy:string|null}[]>)[version]!.filter(n=>n.ascendancy===name);
  if(nodes.length)expect(nodes.every(n=>Math.abs(n.x-entry.x)<entry.width*2&&Math.abs(n.y-entry.y)<entry.height*2)).toBe(true);
 }
 expect(treeArtwork('0.5','Deadeye',false)?.file).toContain('ClassesRanger');
 expect(treeArtwork('0.5','Deadeye',true)?.file).toContain('ClassesDeadeye');
 expect(treeArtwork('future','Deadeye',true)).toBeNull();expect(treeArtwork('0.5','Unknown',false)).toBeNull();
});

it('restores the optional frame setting without changing older panels',()=>{
 expect(restoreView({}).decorativeFrames).toBe(false);
 expect(restoreView({decorativeFrames:'true'}).decorativeFrames).toBe(false);
 const view=restoreView({decorativeFrames:true,weapon:'2'});
 expect(restoreView(JSON.parse(JSON.stringify(view)))).toEqual(view);
});

it.skipIf(!process.env.POE2_REPAIRED_FILE)('covers every gem in the supplied build variants',()=>{
 const data=JSON.parse(readFileSync(process.env.POE2_REPAIRED_FILE!,'utf8'));
 const missing:string[]=[];
 const walk=(g:Gem)=>{if(!gemArtwork(g))missing.push(g.name);g.supports?.forEach(walk);};
 data.build.stages.forEach((stage:{skills:Gem[]})=>stage.skills.forEach(walk));
 expect([...new Set(missing)]).toEqual([]);
});
