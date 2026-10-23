import type { TavoraSDK } from '@tavora/sdk';
import type { Build } from './model';
import { esc } from './html';
import { prepareGuideSave, type GuideImport } from './mobalytics-import';
import { guideAddress } from './guide-sources';
import { readBuildAttachment } from './build-attachment';
import { keptVariant, variantChanges } from './guide-update';
import { t, plural, number, noteText, variantName } from './i18n';

interface Options {
 network:TavoraSDK['network'];
 guides:{id:string;title:string;guideImport?:Build['guideImport']}[];
 /** stage is the variant open in the panel, kept after the update when the guide still has it. */
 initial?:{id:string;build:Build;stage:number}|undefined;
 load:(id:string)=>Promise<Build|null>;
 save:(build:Build)=>Promise<void>;
 onClose:()=>void;
}
export function openGuideImport(options:Options):void {
 const dialog=document.createElement('dialog');dialog.className='character-import guide-import';
 dialog.setAttribute('aria-labelledby','guide-import-title');
 dialog.innerHTML=`<form method="dialog"><div class="character-import-heading"><h2 id="guide-import-title">${esc(t('menu.import'))}</h2><button value="cancel" aria-label="${esc(t('dialog.close'))}">×</button></div></form>
 <details id="guide-entry" open><summary>${esc(t('guideImport.source'))}</summary><label>${esc(t('guideImport.url'))}<input id="guide-url" type="url" placeholder="https://mobalytics.gg/poe-2/builds/ice-shot-deadeye" spellcheck="false"></label>
 <p class="character-import-help">${esc(t('guideImport.help'))}</p>
 <label>${esc(t('guideImport.file'))}<input id="guide-attachment" type="file" accept=".zip,.build,.xml,.json"></label><p class="character-import-help">${esc(t('guideImport.fileHelp'))}</p>
 <button id="guide-read" type="button">${esc(t('dialog.preview'))}</button></details><p id="guide-error" role="status" aria-live="polite"></p>
 <section id="guide-preview" hidden><h3>${esc(t('guideImport.preview'))}</h3><label>${esc(t('dialog.name'))}<input id="guide-name" maxlength="200"></label><p id="guide-summary"></p>
 <label>${esc(t('guideImport.variant'))}<select id="guide-variant"></select></label><ul id="guide-warnings"></ul>
 <label>${esc(t('dialog.saveAs'))}<select id="guide-target"><option value="">${esc(t('dialog.asNew'))}</option>${options.guides.map(g=>`<option value="${esc(g.id)}">${esc(t('dialog.update',{title:g.title}))}</option>`).join('')}</select></label>
 <p id="guide-changes" hidden></p><p>${esc(t('guideImport.saveHint'))}</p><button id="guide-save" type="button">${esc(t('guideImport.save'))}</button></section>`;
 document.body.append(dialog);
 const get=<T extends HTMLElement=HTMLElement>(selector:string)=>dialog.querySelector<T>(selector)!;
 const input=get<HTMLInputElement>('#guide-url'),attachment=get<HTMLInputElement>('#guide-attachment'),name=get<HTMLInputElement>('#guide-name'),variant=get<HTMLSelectElement>('#guide-variant'),target=get<HTMLSelectElement>('#guide-target'),read=get<HTMLButtonElement>('#guide-read'),save=get<HTMLButtonElement>('#guide-save'),status=get('#guide-error');
 let candidate:GuideImport|null=null,serial=0,closed=false,saving=false;
 const invalidate=()=>{serial++;candidate=null;get('#guide-preview').hidden=true;status.textContent='';read.disabled=false;};
 input.oninput=invalidate;attachment.onchange=invalidate;
 // Compare with the build you'd update: variants match by source ID, then exact name. Removals need the save button's explicit wording.
 let removals=0;
 const compare=async()=>{
  const request=serial,changes=get('#guide-changes');removals=0;changes.hidden=true;save.textContent=t('guideImport.save');
  const existing=candidate&&target.value?await options.load(target.value).catch(()=>null):null;
  if(closed||request!==serial||!candidate||!existing||existing.character)return;
  const b=candidate.build,c=variantChanges(existing,b);
  const open=options.initial?.id===target.value?options.initial.stage:existing.defaultStage,kept=keptVariant(existing,b,open);
  if(kept!==undefined)variant.value=String(kept);
  const list=(names:string[])=>names.length>3?t('guideImport.more',{names:names.slice(0,3).join(', '),count:names.length-3}):names.join(', ');
  changes.textContent=[c.added.length?t('guideImport.added',{names:list(c.added)}):'',c.changed.length?t('guideImport.changed',{names:list(c.changed)}):'',c.removed.length?t('guideImport.removed',{names:list(c.removed)}):'',c.same?t('guideImport.same',{count:c.same}):''].filter(Boolean).join('\n');
  changes.hidden=!changes.textContent;removals=c.removed.length;
  if(removals)save.textContent=plural('guideImport.saveRemove',removals);
 };
 target.onchange=()=>void compare();
 read.onclick=()=>void(async()=>{
  const request=++serial;candidate=null;get('#guide-preview').hidden=true;read.disabled=true;status.textContent=t('guideImport.importing');
  try {
   // Validate before making any request, including when a file is attached.
   const address=input.value.trim()?guideAddress(input.value):null;
   let loaded:GuideImport;
   try{if(!address)throw Error(t('error.needGuide'));loaded=await address.load(options.network);}
   catch(error){
    const file=attachment.files?.[0];if(!file)throw error;
    const build=await readBuildAttachment(file);if(build.character)throw Error(t('error.characterFile'));
    if(address&&!build.guideUrl)build.guideUrl=address.canonical;
    loaded={build,method:'file',warnings:[...(address?[error instanceof Error?error.message:String(error)]:[]),...(build.importNotes||[]),t('guideImport.fileLoaded')]};
   }
   if(closed||request!==serial)return;
   candidate=loaded;const b=loaded.build;
   name.value=b.shortTitle;variant.innerHTML=b.stages.map((s,i)=>`<option value="${i}">${esc(variantName(s.label))}</option>`).join('');variant.value=String(b.defaultStage);
   const chapters=b.guideText?.sections||[];
   const characters=chapters.reduce((sum,s)=>sum+s.text.length,0);
   get('#guide-summary').textContent=`${b.ascendancy||t('guideImport.build')} · ${plural('guideImport.variants',b.stages.length)}\n${plural('guideImport.chapters',chapters.length)} · ${plural('guideImport.characters',characters,{count:number(characters)})}\n${loaded.method==='file'?t('guideImport.fromFile'):b.version?t('guideImport.fromGuidePatch',{source:b.source,version:b.version}):t('guideImport.fromGuide',{source:b.source})}${b.importerVersion?`\n${noteText(b.importerVersion)}`:''}`;
   get('#guide-warnings').innerHTML=loaded.warnings.map(w=>`<li>${esc(noteText(w))}</li>`).join('');
   target.value=options.initial?.id||options.guides.find(g=>g.guideImport?.documentId===b.guideImport?.documentId&&b.guideImport)?.id||'';
   get('#guide-preview').hidden=false;get<HTMLDetailsElement>('#guide-entry').open=false;status.textContent=t('guideImport.check');
   await compare();
  }catch(e){if(!closed&&request===serial)status.textContent=e instanceof Error?e.message:String(e);}
  finally{if(!closed&&request===serial)read.disabled=false;}
 })();
 save.onclick=()=>void(async()=>{
  if(!candidate||saving)return;saving=true;
  const controls=[save,read,input,attachment,name,variant,target];for(const c of controls)c.disabled=true;
  try{
   const existing=target.value?await options.load(target.value):null;
   if(target.value&&!existing)throw Error(t('error.guideGone'));
   const b=prepareGuideSave({...candidate.build,defaultStage:Number(variant.value)},name.value,existing);
   status.textContent=t('status.savingBuild');await options.save(b);dialog.close();
  }catch(e){status.textContent=e instanceof Error?e.message:String(e);}
  finally{saving=false;for(const c of controls)c.disabled=false;}
 })();
 dialog.addEventListener('cancel',e=>{if(saving)e.preventDefault();});
 dialog.querySelector('form')!.onsubmit=e=>{if(saving)e.preventDefault();};
 dialog.onclose=()=>{closed=true;serial++;dialog.remove();options.onClose();};
 dialog.showModal();
 if(options.initial)input.value=options.initial.build.guideImport?.url||options.initial.build.guideUrl;
}
