import type { TavoraSDK } from '@tavora/sdk';
import type { Build } from './model';
import { esc } from './html';
import { importMobalytics, mobalyticsAddress, prepareGuideSave, type GuideImport } from './mobalytics-import';
import { readBuildAttachment } from './build-attachment';

interface Options {
 network:TavoraSDK['network'];
 guides:{id:string;title:string;guideImport?:Build['guideImport']}[];
 initial?:{id:string;build:Build}|undefined;
 load:(id:string)=>Promise<Build|null>;
 save:(build:Build)=>Promise<void>;
 onClose:()=>void;
}
export function openGuideImport(options:Options):void {
 const dialog=document.createElement('dialog');dialog.className='character-import guide-import';
 dialog.setAttribute('aria-labelledby','guide-import-title');
 dialog.innerHTML=`<form method="dialog"><div class="character-import-heading"><h2 id="guide-import-title">Import build</h2><button value="cancel" aria-label="Close import">×</button></div></form>
 <details id="guide-entry" open><summary>Guide source</summary><label>Guide URL<input id="guide-url" type="url" placeholder="https://mobalytics.gg/poe-2/builds/ice-shot-deadeye" spellcheck="false"></label>
 <p class="character-import-help">Supported: Mobalytics PoE 2 build guides. Imports all available variants and guide text. No AI or account sign-in.</p>
 <label>Build file (optional)<input id="guide-attachment" type="file" accept=".zip,.build,.xml,.json"></label><p class="character-import-help">If the page cannot be read, attach its planner ZIP, .build, PoB XML or saved Tavora build. The preview shows what is available.</p>
 <button id="guide-read" type="button">Preview import</button></details><p id="guide-error" role="status" aria-live="polite"></p>
 <section id="guide-preview" hidden><h3>Build preview</h3><label>Name<input id="guide-name" maxlength="200"></label><p id="guide-summary"></p>
 <label>Open variant<select id="guide-variant"></select></label><ul id="guide-warnings"></ul>
 <label>Save as<select id="guide-target"><option value="">Import as new</option>${options.guides.map(g=>`<option value="${esc(g.id)}">Update ${esc(g.title)}</option>`).join('')}</select></label>
 <p>Your saved build changes only after a successful save.</p><button id="guide-save" type="button">Save build</button></section>`;
 document.body.append(dialog);
 const get=<T extends HTMLElement=HTMLElement>(selector:string)=>dialog.querySelector<T>(selector)!;
 const input=get<HTMLInputElement>('#guide-url'),attachment=get<HTMLInputElement>('#guide-attachment'),name=get<HTMLInputElement>('#guide-name'),variant=get<HTMLSelectElement>('#guide-variant'),target=get<HTMLSelectElement>('#guide-target'),read=get<HTMLButtonElement>('#guide-read'),save=get<HTMLButtonElement>('#guide-save'),status=get('#guide-error');
 let candidate:GuideImport|null=null,serial=0,closed=false,saving=false;
 const invalidate=()=>{serial++;candidate=null;get('#guide-preview').hidden=true;status.textContent='';read.disabled=false;};
 input.oninput=invalidate;attachment.onchange=invalidate;
 read.onclick=()=>void(async()=>{
  const request=++serial;candidate=null;get('#guide-preview').hidden=true;read.disabled=true;status.textContent='Importing guide…';
  try {
   // Validate before making any request, including when a file is attached.
   const address=input.value.trim()?mobalyticsAddress(input.value):null;
   let loaded:GuideImport;
   try{if(!address)throw Error('Paste a guide URL or attach a build file.');loaded=await importMobalytics(address.url,options.network);}
   catch(error){
    const file=attachment.files?.[0];if(!file)throw error;
    const build=await readBuildAttachment(file);if(build.character)throw Error('Use Import character for character files.');
    if(address&&!build.guideUrl)build.guideUrl=address.canonical;
    loaded={build,method:'file',warnings:[...(address?[error instanceof Error?error.message:String(error)]:[]),...(build.importNotes||[]),'Loaded the attached file. Text absent from the file is unavailable; it has not been invented.']};
   }
   if(closed||request!==serial)return;
   candidate=loaded;const b=loaded.build;
   name.value=b.shortTitle;variant.innerHTML=b.stages.map((s,i)=>`<option value="${i}">${esc(s.label)}</option>`).join('');variant.value=String(b.defaultStage);
   const chapters=b.guideText?.sections||[];
   get('#guide-summary').textContent=`${b.ascendancy||'Build'} · ${b.stages.length} variants\n${chapters.length} guide chapters · ${chapters.reduce((sum,s)=>sum+s.text.length,0).toLocaleString()} text characters\nSource: ${loaded.method==='file'?'attached build file':'Mobalytics guide'}`;
   get('#guide-warnings').innerHTML=loaded.warnings.map(w=>`<li>${esc(w)}</li>`).join('');
   target.value=options.initial?.id||options.guides.find(g=>g.guideImport?.documentId===b.guideImport?.documentId&&b.guideImport)?.id||'';
   get('#guide-preview').hidden=false;get<HTMLDetailsElement>('#guide-entry').open=false;status.textContent='Check the build, then save.';
  }catch(e){if(!closed&&request===serial)status.textContent=e instanceof Error?e.message:String(e);}
  finally{if(!closed&&request===serial)read.disabled=false;}
 })();
 save.onclick=()=>void(async()=>{
  if(!candidate||saving)return;saving=true;
  const controls=[save,read,input,attachment,name,variant,target];for(const c of controls)c.disabled=true;
  try{
   const existing=target.value?await options.load(target.value):null;
   if(target.value&&!existing)throw Error('That saved guide is no longer available. Import as new instead.');
   const b=prepareGuideSave({...candidate.build,defaultStage:Number(variant.value)},name.value,existing);
   status.textContent='Saving build…';await options.save(b);dialog.close();
  }catch(e){status.textContent=e instanceof Error?e.message:String(e);}
  finally{saving=false;for(const c of controls)c.disabled=false;}
 })();
 dialog.addEventListener('cancel',e=>{if(saving)e.preventDefault();});
 dialog.querySelector('form')!.onsubmit=e=>{if(saving)e.preventDefault();};
 dialog.onclose=()=>{closed=true;serial++;dialog.remove();options.onClose();};
 dialog.showModal();
 if(options.initial)input.value=options.initial.build.guideImport?.url||options.initial.build.guideUrl;
}
