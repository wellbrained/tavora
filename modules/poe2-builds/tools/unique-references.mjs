// Generate range-only unique references from a local PoB Community PoE2 checkout.
// Usage: node tools/unique-references.mjs <PoB folder>
import fs from 'node:fs';
import path from 'node:path';
const root=process.argv[2];if(!root)throw Error('Pass the PoB Community PoE2 folder.');
const records={};
for(const file of fs.readdirSync(path.join(root,'Data/Uniques')).filter(f=>f.endsWith('.lua'))){
 const source=fs.readFileSync(path.join(root,'Data/Uniques',file),'utf8');
 for(const [,body]of source.matchAll(/\[\[([\s\S]*?)\]\]/g)){
  const lines=body.trim().split(/\r?\n/).map(l=>l.trim()).filter(Boolean),name=lines[0],base=lines[1];
  if(!name||!base)continue;
  const variants=lines.filter(l=>l.startsWith('Variant: ')).map(l=>l.slice(9));
  const current=variants.indexOf('Current')+1;
  const boundary=lines.findIndex(l=>/^Implicits: \d+$/.test(l));
  const mods=lines.slice(boundary>=0?boundary+1:2).filter(l=>!/^\w[\w ]*: /.test(l)&&!/^Requires Level /.test(l)).flatMap(l=>{
   const variant=/\{variant:([^}]+)\}/.exec(l);
   if(variant&&(!current||!variant[1].split(',').includes(String(current))))return [];
   return [l.replace(/\{[^}]*\}/g,'')];
  });
  const implicit=boundary>=0?Number(lines[boundary].slice(11)):0;
  records[name]={base,implicit:mods.slice(0,implicit),explicit:mods.slice(implicit),...(variants.length&&!current?{variantRequired:true}:{})};
 }
}
fs.writeFileSync(new URL('../src/unique-references.json',import.meta.url),JSON.stringify(records)+'\n');
console.log(`Generated ${Object.keys(records).length} range-only references.`);
