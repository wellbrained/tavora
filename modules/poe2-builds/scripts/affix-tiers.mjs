// Builds src/affix-tiers.json from a local Path of Building Community (PoE2) install.
// Usage: node scripts/affix-tiers.mjs ["C:/Users/<you>/AppData/Roaming/Path of Building Community (PoE2)"]
// Tiers are ranked per item base the way PoB's crafting editor does (ItemsTab.lua UpdateAffixControl):
// mods of one type that can spawn on the base, grouped by identical statOrder, highest level = tier 1.
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

const root=process.argv[2]||join(process.env.APPDATA||'','Path of Building Community (PoE2)');
const pobVersion=/<Version number="([^"]+)"/.exec(readFileSync(join(root,'manifest.xml'),'utf8'))?.[1];
if(!pobVersion)throw Error('No PoB manifest.xml in '+root);

/** Reads the Lua table constructors PoB generates: strings, numbers, booleans, nested tables. */
function lua(source){
 let at=0;
 const space=()=>{for(;;){while(/\s/.test(source[at]||''))at++;if(source.startsWith('--',at)){while(at<source.length&&source[at]!=='\n')at++;}else return;}};
 const string=()=>{const quote=source[at++];let out='';while(source[at]!==quote){if(source[at]==='\\'){at++;const c=source[at++];out+=c==='n'?'\n':c==='t'?'\t':c;}else out+=source[at++];}at++;return out;};
 const value=()=>{
  space();const c=source[at];
  if(c==='"'||c==="'")return string();
  if(c==='{')return table();
  const m=/^(-?[\d.]+(?:e-?\d+)?|true|false|nil)/.exec(source.slice(at,at+40));
  if(!m)throw Error('Unexpected Lua at '+at+': '+source.slice(at,at+40));
  at+=m[0].length;return m[0]==='true'?true:m[0]==='false'?false:m[0]==='nil'?null:Number(m[0]);
 };
 function table(){
  at++;const out={list:[],keys:{}};
  for(;;){
   space();if(source[at]==='}'){at++;return out;}
   if(source[at]==='['){at++;const key=value();space();at++;space();at++;out.keys[key]=value();}
   else{const m=/^([A-Za-z_]\w*)\s*=(?!=)/.exec(source.slice(at,at+80));if(m){at+=m[0].length;out.keys[m[1]]=value();}else out.list.push(value());}
   space();if(source[at]===','||source[at]===';')at++;
  }
 }
 return {value,seek(i){at=i;}};
}
const parseReturn=file=>{const text=readFileSync(file,'utf8'),p=lua(text);p.seek(text.indexOf('return')+6);return p.value().keys;};

// Mod tables PoB picks per item type (Modules/Data.lua data.itemMods); desecrated mods come from ModVeiled.
const sources={Item:'ModItem',Veiled:'ModVeiled',Jewel:'ModJewel',Flask:'ModFlask',Charm:'ModCharm'};
const mods=[],seen=new Map();
for(const [table,file] of Object.entries(sources))for(const [id,m] of Object.entries(parseReturn(join(root,'Data',file+'.lua')))){
 const k=m.keys;if(k.type!=='Prefix'&&k.type!=='Suffix')continue;
 const lines=m.list.filter(l=>typeof l==='string');
 // Data.lua words Time-Lost jewel lines as they show on the item.
 if((/JewelRadius|AbyssModRadiusJewel/.test(id))&&lines[0]&&[1,2].includes(k.nodeType))lines[0]=(k.nodeType===1?'Small':'Notable')+' Passive Skills in Radius also grant '+lines[0];
 const mod={id,table,type:k.type[0],affix:k.affix||'',lines,statOrder:(k.statOrder?.list||[]).join(','),level:k.level||0,weightKey:k.weightKey?.list||[],weightVal:k.weightVal?.list||[]};
 // ModFlask and ModCharm share some mods; one copy is enough when both say the same.
 const same=seen.get(id);
 if(same){const {table:_a,...a}=same,{table:_b,...b}=mod;if(JSON.stringify(a)!==JSON.stringify(b))throw Error('Two different mods are called '+id);continue;}
 seen.set(id,mod);mods.push(mod);
}

const bases=new Map();
for(const file of readdirSync(join(root,'Data','Bases')).filter(f=>f.endsWith('.lua'))){
 const text=readFileSync(join(root,'Data','Bases',file),'utf8'),p=lua(text);
 for(const m of text.matchAll(/^itemBases\["((?:[^"\\]|\\.)*)"\]\s*=\s*/gm)){p.seek(m.index+m[0].length);const base=p.value().keys;bases.set(m[1],{type:base.type,tags:new Set(Object.keys(base.tags?.keys||{}))});}
}
const baseTags=new Set([...bases.values()].flatMap(b=>[...b.tags]));
// Influence and Abyssal-lord tags (destruction, amanamu_mod...) are never on a base; the mod brings them along.
const special=m=>m.weightKey.filter((key,i)=>!baseTags.has(key)&&m.weightVal[i]>0);
// GetModSpawnWeight: the first weight key the base has decides.
const weight=(m,tags)=>{for(const [i,key] of m.weightKey.entries())if(tags.has(key))return m.weightVal[i];return 0;};
const tableFor=type=>type==='Flask'||type==='Charm'?['Flask','Charm']:type==='Jewel'?['Jewel']:['Item','Veiled'];

const modIndex=new Map(mods.map((m,i)=>[m.id,i]));
const seriesIndex=new Map(),series=[],classIndex=new Map(),classes=[],baseClass={},jewellery=new Set();
const natural=(a,b)=>a.localeCompare(b,'en',{numeric:true});
for(const [name,base] of [...bases].sort(([a],[b])=>natural(a,b))){
 const tables=tableFor(base.type),groups=new Map();
 for(const m of mods){
  if(!tables.includes(m.table))continue;
  const extra=special(m),tags=extra.length?new Set([...base.tags,...extra]):base.tags;
  if(weight(m,tags)<=0)continue;
  // A special-tag mod only ranks against mods spawning with the same tags.
  const key=[m.table,m.type,m.statOrder,extra.join('+')].join('|');
  if(!groups.has(key))groups.set(key,[]);groups.get(key).push(m);
 }
 const list=[...groups.values()].map(g=>g.sort((a,b)=>b.level-a.level||natural(a.id,b.id)).map(m=>modIndex.get(m.id)));
 if(!list.length)continue;
 const ids=list.map(s=>{const key=s.join(',');if(!seriesIndex.has(key)){seriesIndex.set(key,series.length);series.push(s);}return seriesIndex.get(key);}).sort((a,b)=>a-b);
 const key=ids.join(',');if(!classIndex.has(key)){classIndex.set(key,classes.length);classes.push(ids);}
 baseClass[name]=classIndex.get(key);
 // Catalyst quality raises the rolls on rings, amulets and belts, so a value there may sit above its range.
 if(['Amulet','Ring','Belt'].includes(base.type))jewellery.add(classIndex.get(key));
}
// Mods outside every series have a type but no tier; keep only the mods some base uses or that never spawn.
// Mods stay grouped by table: tableStarts[i] is where table i begins, so a mod needs no table field.
const used=new Set(series.flat()),tables=Object.keys(sources);
const kept=mods.map((m,i)=>[m,i]).filter(([m,i])=>used.has(i)||m.weightVal.every(v=>v<=0));
const remap=new Map(kept.map(([,i],n)=>[i,n]));
// PoB orders equal levels arbitrarily, so such a series names the type but no tier.
const ties=series.flatMap((s,n)=>s.some((m,i)=>i&&mods[m].level===mods[s[i-1]].level)?[n]:[]);
const output={
 pob:pobVersion,
 tables,
 tableStarts:tables.map(t=>kept.findIndex(([m])=>m.table===t)),
 mods:kept.map(([m])=>[m.id,m.type,m.affix,m.lines]),
 series:series.map(s=>s.map(i=>remap.get(i))),
 untiered:ties,
 classes,
 catalyst:[...jewellery].sort((a,b)=>a-b),
 bases:baseClass,
};
const file=new URL('../src/affix-tiers.json',import.meta.url);
writeFileSync(file,JSON.stringify(output));
for(const n of ties)console.log('Equal levels:',series[n].map(i=>`${mods[i].id}@${mods[i].level}`).join(' '));
console.log(`PoB ${pobVersion}: ${output.mods.length} mods, ${series.length} series, ${classes.length} base classes, ${Object.keys(baseClass).length} bases, ${(JSON.stringify(output).length/1024).toFixed(0)} KiB`);
