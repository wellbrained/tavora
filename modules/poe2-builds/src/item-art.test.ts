import { expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { itemArtwork, itemImage } from './item-art';
import catalogue from './item-art.json';
import { gearCard } from './presentation';
import { validate } from './validate.js';
import type { Item } from './model';
const item = (name: string, base?: string, rarity?: string): Item => ({inventory_id:'Weapon1',name,...(base ? {base} : {}),...(rarity ? {rarity} : {}),mods:[]});
it('matches exact uniques with normalized apostrophes and keeps their art instead of the base',()=>{
 const unique = item("Cadiro’s Gambit",'Primed Quiver','unique');
 expect(itemArtwork(unique)).toMatch(/^assets\/items\/[a-f0-9]+\.webp$/);
 expect(itemArtwork(unique)).toBe(itemArtwork({...unique,name:" Cadiro's Gambit "}));
 expect(itemArtwork(unique)).not.toBe(itemArtwork(item('Primed Quiver')));
 expect(gearCard(unique,'')).toContain(itemArtwork(unique)!);
});
it('uses the base of crafted rare and magic items, without remote-image inputs',()=>{
 expect(itemArtwork(item('Doom Song','Warmonger Bow','rare'))).toBe(itemArtwork(item('Warmonger Bow')));
 expect(itemArtwork(item('Glowing Warmonger Bow','Warmonger Bow','magic'))).toBe(itemArtwork(item('Warmonger Bow')));
 expect(itemImage(item('https://example.org/icon.png'))).toEqual({src:'assets/icons/gear-weapon.svg',actual:false});
 expect(itemArtwork(item('Unknown unique','Warmonger Bow','unique'))).toBeUndefined();
});
it('bundles every catalogue texture with a safe relative filename',()=>{
 expect(Object.keys(catalogue).length).toBeGreaterThan(2000);
 for(const name of new Set(Object.values(catalogue))) {
  expect(name).toMatch(/^[a-f0-9]{20}\.webp$/);
  expect(existsSync(fileURLToPath(new URL('../public/assets/items/'+name,import.meta.url)))).toBe(true);
 }
});
it('covers all supplied endgame build variants when the local smoke fixture is available',()=>{
 const fixture=process.env['POE2_SMOKE_FILE'];if(!fixture)return;
 const build=validate(JSON.parse(readFileSync(fixture,'utf8')));
 for(const stage of build.stages)for(const entry of stage.items)expect(itemArtwork(entry),entry.name).toBeDefined();
});
