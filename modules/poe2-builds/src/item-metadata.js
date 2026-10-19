const plain=v=>v&&typeof v==='object'&&!Array.isArray(v);
const str=(v,max=2000)=>typeof v==='string'?v.slice(0,max):'';
const list=(v,max=500)=>Array.isArray(v)?v.slice(0,max):[];
const integer=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max;
function affix(v,depth=0){
 if(!plain(v)||!['P','S'].includes(v.type))return null;
 const out={text:str(v.text),type:v.type,id:str(v.id),name:str(v.name),evidence:str(v.evidence),status:['Crafted','Fractured','Desecrated'].includes(v.status)?v.status:'',instanceId:str(v.instanceId)};
 if(integer(v.tier,1,100))out.tier=v.tier;
 if(['start','middle','end'].includes(v.hybrid))out.hybrid=v.hybrid;
 if(depth===0&&Array.isArray(v.contributors))out.contributors=list(v.contributors,6).map(c=>affix(c,1)).filter(Boolean);
 return out;
}
function property(v){
 if(!plain(v)||typeof v.name!=='string')return null;
 return {name:str(v.name),values:list(v.values,20).filter(x=>Array.isArray(x)&&typeof x[0]==='string').map(x=>[str(x[0]),integer(x[1],0,100)?x[1]:0]),displayMode:integer(v.displayMode,0,5)?v.displayMode:0};
}
/** Additive portable-v1 fields. Unknown executable/HTML values never enter the display model. */
export function itemMetadata(v){
 const out={};
 if(integer(v.itemLevel,1,1000))out.itemLevel=v.itemLevel;
 if(typeof v.corrupted==='boolean')out.corrupted=v.corrupted;
 if(Number.isFinite(v.dps)&&v.dps>=0&&v.dps<1e12)out.dps=v.dps;
 for(const k of ['properties','requirements','grantedSkills'])if(Array.isArray(v[k]))out[k]=list(v[k],50).map(property).filter(Boolean);
 if(Array.isArray(v.affixRows))out.affixRows=list(v.affixRows).map(a=>affix(a)).filter(Boolean);
 if(Array.isArray(v.sourceSections))out.sourceSections=list(v.sourceSections,30).filter(s=>plain(s)&&['implicitMods','explicitMods','fracturedMods','craftedMods','desecratedMods','runeMods','enchantMods','bondedMods'].includes(s.kind)).map(s=>({kind:s.kind,mods:list(s.mods).filter(x=>typeof x==='string').map(x=>str(x,10000))}));
 return out;
}
export function questChoices(v){return list(v,50).filter(plain).map(x=>({quest:str(x.quest),act:str(x.act),area:str(x.area),reward:str(x.reward,10000)})).filter(x=>x.reward);}
export function questAdvice(v){return list(v,50).filter(plain).map(x=>({text:str(x.text,20000),quest:str(x.quest)})).filter(x=>x.text);}
