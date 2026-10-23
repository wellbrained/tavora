// Generate the text of every prefix and suffix by its game mod ID from a local PoB Community PoE2 checkout.
// Mobalytics names the mods on a guide's rare jewels only by these IDs.
// Usage: node tools/mod-texts.mjs <PoB folder>
import fs from 'node:fs';
import path from 'node:path';
const root=process.argv[2];if(!root)throw Error('Pass the PoB Community PoE2 folder.');
const records={};
// Jewel mods first: an ID found in both files is read as the jewel's.
for(const file of ['ModJewel.lua','ModItem.lua']){
 const source=fs.readFileSync(path.join(root,'Data',file),'utf8');
 for(const [,id,type,body] of source.matchAll(/^\t\["([^"]+)"\] = \{ type = "(Prefix|Suffix)", affix = "[^"]*", (.*?), statOrder/gm)){
  if(Object.hasOwn(records,id))continue;
  // A line that starts with a space carries on the one before it.
  const lines=[...body.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(m=>m[1].replace(/\\(.)/g,'$1'))
   .reduce((all,line)=>/^\s/.test(line)&&all.length?[...all.slice(0,-1),all.at(-1)+line]:[...all,line],[]);
  if(lines.length)records[id]=[type[0],...lines.map(l=>l.trim())];
 }
}
fs.writeFileSync(new URL('../src/mod-texts.json',import.meta.url),JSON.stringify(records)+'\n');
console.log(`Generated ${Object.keys(records).length} mod texts.`);
