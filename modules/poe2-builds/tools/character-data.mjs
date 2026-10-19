// Generate compact import lookup tables from a local PoB Community PoE2 checkout.
// Usage: node tools/character-data.mjs <PoB folder>
import fs from 'node:fs';
import path from 'node:path';
const root = process.argv[2];
if (!root) throw Error('Pass the PoB Community PoE2 folder.');
const gems = {};
for (const [,id,body] of fs.readFileSync(path.join(root,'Data/Gems.lua'),'utf8').matchAll(/\["([^"]+)"\] = \{([\s\S]*?)\n\t\},/g)) {
 const name = /\bname = "([^"]+)"/.exec(body)?.[1];
 if (!name) continue;
 gems[id] = {name, gameId:/gameId = "([^"]+)"/.exec(body)?.[1]||id, effect:/grantedEffectId = "([^"]+)"/.exec(body)?.[1]||'', tier:Number(/Tier = (\d+)/.exec(body)?.[1]||0), attributes:['strength','dexterity','intelligence'].filter((a,i)=>new RegExp('\\b'+a+' = true').test(body)||Number(new RegExp('req'+['Str','Dex','Int'][i]+' = (\\d+)').exec(body)?.[1]||0)>0).map(a=>a[0].toUpperCase()+a.slice(1)), support:/\bsupport = true/.test(body), tags:(/tagString = "([^"]+)"/.exec(body)?.[1]||'').split(', ').filter(Boolean)};
}
const ascendancies = {};
for (const version of ['0.4','0.5']) {
 const tree = fs.readFileSync(path.join(root,'TreeData',version.replace('.','_'),'tree.lua'),'utf8');
 ascendancies[version] = Object.fromEntries([...tree.matchAll(/internalId="([^"]+)"[\s\S]*?name="([^"]+)"/g)].map(m=>[m[1],m[2]]));
}
fs.writeFileSync(new URL('../src/character-data.json',import.meta.url),JSON.stringify({gems,ascendancies})+'\n');
console.log(`Generated ${Object.keys(gems).length} gem identities.`);
