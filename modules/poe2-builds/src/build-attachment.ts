import lookup from './character-data.json';
import nodeIds from './planner-node-ids.json';
import { decodePob, parsePob } from './pob-import';
import { portable, MAX_FILE_BYTES, type Build, type Gem, type Stage } from './model';
import { validate } from './validate.js';

const MAX_EXPANDED=10*1024*1024;
const object=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const array=(v:unknown):unknown[]=>Array.isArray(v)?v:[];
const string=(v:unknown)=>typeof v==='string'?v:'';
const normalize=(v:string)=>v.replace('/Gem/','/Gems/');
const gems=new Map(Object.entries(lookup.gems).flatMap(([id,g])=>[[normalize(id),{id,...g}],[normalize(g.gameId),{id,...g}]] as const));
function plannerGem(value:unknown):Gem {
 const source=object(value),id=string(source.id),known=gems.get(normalize(id));
 if(!known)throw Error(`This planner uses a gem not bundled in this module (${id}). Use a PoB export instead.`);
 const levels=array(source.level_interval).filter((n):n is number=>typeof n==='number');
 return {id,name:known.name,attributes:known.attributes,isSupport:known.support,tags:known.tags,levels,supports:array(source.support_skills).map(plannerGem)};
}
function plannerStage(source:Record<string,unknown>):Stage {
 if(!Array.isArray(source.inventory_slots)||!Array.isArray(source.skills)||!Array.isArray(source.passives))throw Error('That file is not a supported PoE 2 .build export.');
 const passives=source.passives.map(value=>{
  const node=object(value),id=(nodeIds as Record<string,string>)[string(node.id)];
  if(!id)throw Error('This planner uses a passive not in the bundled tree. Use a current PoB export instead.');
  return {id,weapon:[1,2].includes(Number(node.weapon_set))?Number(node.weapon_set):0};
 });
 const items=source.inventory_slots.map(value=>{
  const item=object(value),lines=string(item.additional_text).split(/\r?\n/).filter(Boolean),inventory=string(item.inventory_id);
  return {inventory_id:['Helm','BodyArmour','Gloves','Boots','Belt','Amulet','Ring'].includes(inventory)?inventory+'1':inventory,
   name:string(item.unique_name)||lines[0]||inventory,base:lines[0]||'',mods:lines.slice(1).map(s=>s.replace(/^\d+\.\s*/,'')),slot_x:Number(item.slot_x)||0,
   level_interval:array(item.level_interval).filter((n):n is number=>typeof n==='number'),...(item.unique_name?{rarity:'unique'}:{})};
 });
 const ascendancy=(lookup.ascendancies['0.5'] as Record<string,string>)[string(source.ascendancy)]||'';
 return {name:string(source.name)||'Attached build',label:string(source.name)||'Attached build',author:string(source.author),items,skills:source.skills.map(plannerGem),passives,ascendancy};
}
const crc32=(bytes:Uint8Array)=>{let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;};

/** Read bounded entries directly. No files are extracted and no archive paths are followed. */
export async function plannerZip(bytes:Uint8Array):Promise<{name:string;text:string}[]> {
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength), decoder=new TextDecoder('utf-8',{fatal:true});
 let end=bytes.length-22;for(;end>=Math.max(0,bytes.length-65557);end--)if(view.getUint32(end,true)===0x06054b50)break;
 if(end<0||view.getUint32(end,true)!==0x06054b50)throw Error('That ZIP has no supported directory.');
 if(view.getUint16(end+4,true)||view.getUint16(end+6,true))throw Error('Multipart ZIPs are not supported.');
 const count=view.getUint16(end+10,true);let at=view.getUint32(end+16,true),expanded=0;
 if(count>100)throw Error('Choose a ZIP with at most 100 entries.');
 const output:{name:string;text:string}[]=[];
 for(let i=0;i<count;i++){
  if(at+46>bytes.length||view.getUint32(at,true)!==0x02014b50)throw Error('The ZIP directory is damaged.');
  const flags=view.getUint16(at+8,true),method=view.getUint16(at+10,true),crc=view.getUint32(at+16,true),packed=view.getUint32(at+20,true),size=view.getUint32(at+24,true);
  const length=view.getUint16(at+28,true),extra=view.getUint16(at+30,true),comment=view.getUint16(at+32,true),offset=view.getUint32(at+42,true);
  if(at+46+length+extra+comment>bytes.length)throw Error('The ZIP directory is damaged.');
  const name=decoder.decode(bytes.subarray(at+46,at+46+length));at+=46+length+extra+comment;
  if(!/\.build$/i.test(name))continue;
  if(flags&1||![0,8].includes(method)||size>MAX_EXPANDED||expanded+size>MAX_EXPANDED)throw Error('Choose an unencrypted planner ZIP under 10 MB expanded.');
  if(offset+30>bytes.length||view.getUint32(offset,true)!==0x04034b50)throw Error('The ZIP entry is damaged.');
  const start=offset+30+view.getUint16(offset+26,true)+view.getUint16(offset+28,true);
  if(start+packed>bytes.length)throw Error('The ZIP entry is incomplete.');
  let content=bytes.subarray(start,start+packed);
  if(method===8){
   const reader=new Blob([content as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
   const chunks:Uint8Array[]=[];let read=0;
   try{while(true){const part=await reader.read();if(part.done)break;read+=part.value.length;if(read>size||expanded+read>MAX_EXPANDED){await reader.cancel();throw Error('The expanded ZIP exceeds its limit.');}chunks.push(part.value);}}
   finally{reader.releaseLock();}
   content=new Uint8Array(read);let pos=0;for(const chunk of chunks){content.set(chunk,pos);pos+=chunk.length;}
  }
  if(content.length!==size||crc32(content)!==crc)throw Error('The planner ZIP failed its integrity check.');
  expanded+=content.length;output.push({name,text:decoder.decode(content)});
 }
 if(!output.length)throw Error('This ZIP contains no .build files.');return output;
}

export async function readBuildAttachment(file:File):Promise<Build> {
 if(file.size>MAX_FILE_BYTES)throw Error('Choose a build attachment up to 24 MB.');
 if(/\.xml$/i.test(file.name)){
  const parsed=parsePob(await decodePob(await file.text()),file.name.replace(/\.xml$/i,''));
  const {character:_character,characterExport:_xml,...build}=parsed.build;
  return validate(portable({...build,title:build.shortTitle+' · PoB',guideUrl:''}));
 }
 const entries=/\.zip$/i.test(file.name)?await plannerZip(new Uint8Array(await file.arrayBuffer())):[{name:file.name,text:await file.text()}];
 if(entries.length===1){const document=JSON.parse(entries[0]!.text);if(document.format==='tavora.build')return validate(document);}
 const stages=entries.map(entry=>plannerStage(object(JSON.parse(entry.text))));
 const first=stages[0]!,name=file.name.replace(/\.(zip|build)$/i,'');
 return validate(portable({id:'attached',fileId:crypto.randomUUID(),title:name+' · Build file',shortTitle:name,source:'Build file',version:'',treeVersion:'0.5',ascendancy:first.ascendancy||'',guideUrl:'',guideText:null,stages,defaultStage:0,
  importNotes:['This attachment contains planner data only. Guide text can be included when its public page is available.']}));
}
