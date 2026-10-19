import { readFile } from 'node:fs/promises';
import { expect,it,vi } from 'vitest';
import { importMobalytics,lexicalText,mobalyticsAddress,parseMobalytics,prepareGuideSave,publicDocument } from './mobalytics-import';
import { portable } from './model';
import { validate } from './validate.js';

const url='https://mobalytics.gg/poe-2/builds/example?ws-widget=activeVariantId%2C4';
const rich=(text:string)=>({value:{root:{type:'root',children:[{type:'paragraph',children:[{type:'text',text}]}]}}});
const fixture={id:'public-guide',version:7,data:{name:'Example',childrenIds:['root'],buildVariants:{values:['default-variant','4'].map(id=>({id,equipment:{helmet:{commonItem:{name:'Desert Cap',explicitDescriptions:[{description:'+100 to maximum Life'}]}}},skillGems:{gems:[{activeSkill:{gemSlug:'iceshotplayer',name:'Ice Shot'},subSkills:[{gemSlug:'supportelementalarmamentplayertwo',gemType:'SUPPORT'}]}]},passiveTree:{mainTree:{selectedSlugs:['node-4']},set1Tree:{selectedSlugs:['node-16']}}}))}},content:[
 {id:'root',data:{childrenIds:['intro','variants']}},
 {id:'intro',data:{title:'Build Overview',simplifiedContent:rich('Original author words with } and \\".')}},
 {id:'variants',data:{childrenVariants:[{id:'default-variant',title:'Early',childrenIds:['early']},{id:'4',title:'Endgame',childrenIds:['late']}]}},
 {id:'early',data:{title:'Skills',descriptionPoeSkillGems:rich('Early skills only.')}},
 {id:'late',data:{title:'Skills',descriptionPoeSkillGems:rich('Endgame skills only.')}}
]};
const html='<script>window.__PRELOADED_STATE__='+JSON.stringify({store:{userGeneratedDocumentBySlug:{data:fixture}}})+';</script>';
it('accepts only supported public guide URLs and selects source IDs, not array positions',()=>{
 for(const bad of ['http://mobalytics.gg/poe-2/builds/example','https://mobalytics.gg.evil.test/poe-2/builds/example','https://user@mobalytics.gg/poe-2/builds/example','https://mobalytics.gg:444/poe-2/builds/example','https://mobalytics.gg/poe-2/builds'])expect(()=>mobalyticsAddress(bad)).toThrow();
 expect(mobalyticsAddress(url).variant).toBe('4');
 const build=parseMobalytics(publicDocument(html),url);
 expect(build.defaultStage).toBe(1);expect(build.stages.map(s=>s.label)).toEqual(['Early','Endgame']);
 expect(build.guideText?.stageNotes).toEqual({'0':{skills:'Early skills only.'},'1':{skills:'Endgame skills only.'}});
 expect(build.stages[0]?.skills[0]?.supports?.[0]).toMatchObject({name:'Elemental Armament II',attributes:['Strength'],isSupport:true});
 expect(build.stages[0]?.items[0]?.rarity).toBe('unknown');
 expect(validate(portable(build)).guideText).toEqual(build.guideText);
 expect(validate(portable(build)).guideImport).toEqual(build.guideImport);
});
it('reads static JSON without evaluating scripts and retains inline names and links',()=>{
 expect(publicDocument(html).id).toBe('public-guide');
 expect(()=>publicDocument('<script>window.__PRELOADED_STATE__=(()=>alert(1))()</script>')).toThrow();
 expect(lexicalText({root:{children:[{type:'paragraph',children:[{type:'static-data-widget',label:'Barrage'},{type:'text',text:' → '},{type:'static-data-widget',label:'Snipe'}]},{type:'link',url:'/poe-2/builds/other',children:[{type:'text',text:'Read more'}]}]}},url)).toContain('Barrage → Snipe\n\nRead more (https://mobalytics.gg/poe-2/builds/other)');
});
it('uses the hidden public page only when direct fetching cannot provide structured data',async()=>{
 const readPage=vi.fn(async()=>({url,status:200,title:'Example',html}));
 const result=await importMobalytics(url,{fetch:async()=>({url,status:403,headers:{},body:''}),readPage});
 expect(result.method).toBe('browser');expect(readPage).toHaveBeenCalledWith(url);
 const direct=await importMobalytics(url,{fetch:async()=>({url,status:200,headers:{},body:html}),readPage});
 expect(direct.method).toBe('direct');expect(readPage).toHaveBeenCalledTimes(1);
});
it('requires an explicit update target and prevents replacing a different guide',()=>{
 const b=parseMobalytics(fixture,url),other={...b,fileId:'saved',guideImport:{...b.guideImport!,documentId:'different'}};
 expect(prepareGuideSave(b,'Named build',null).fileId).toBe(b.fileId);
 expect(prepareGuideSave(b,'Named build',{...b,fileId:'saved'}).fileId).toBe('saved');
 expect(()=>prepareGuideSave(b,'Named build',other)).toThrow('different guide');
 expect(()=>prepareGuideSave({...b,guideText:null},'Named build',b)).toThrow('no guide text');
 expect(()=>prepareGuideSave(b,'',null)).toThrow();
});
it.skipIf(!process.env.POE2_GUIDE_SMOKE_HTML)('imports the captured public guide across all variants',async()=>{
 const response=JSON.parse(await readFile(process.env.POE2_GUIDE_SMOKE_HTML!,'utf8'));
 const b=parseMobalytics(publicDocument(response.html),'https://mobalytics.gg/poe-2/builds/ice-shot-deadeye?ws-ngf5-f7d82102-7e77-4a44-ad24-33b67e8ae7bf=activeVariantId%2C4');
 expect(b.stages).toHaveLength(6);expect(b.defaultStage).toBe(4);
 expect(b.stages.every(s=>s.items.length>10&&s.skills.length>5&&s.passives.length>100)).toBe(true);
 expect(b.guideText!.sections!.length).toBeGreaterThan(20);
 expect(b.guideText!.sections!.some(s=>s.text.includes('Barrage')&&s.text.includes('Snipe'))).toBe(true);
 expect(b.questSelections!.length).toBeGreaterThan(10);
 expect(b.stages[4]!.items.find(i=>i.name==='Headhunter')).toMatchObject({rarity:'unique',reference:true,base:'Heavy Belt'});
 expect(b.stages[4]!.items.find(i=>i.name==='Headhunter')!.mods.length).toBeGreaterThan(3);
 console.log(JSON.stringify({variants:b.stages.length,chapters:b.guideText!.sections!.length,characters:b.guideText!.sections!.reduce((n,s)=>n+s.text.length,0),items:b.stages.map(s=>s.items.length)}));
});
