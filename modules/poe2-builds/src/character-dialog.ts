import type { TavoraSDK } from '@tavora/sdk';
import type { Build, Character } from './model';
import { esc } from './html';
import { importNinja, prepareCharacterSave, type CharacterImport } from './character-import';
import { decodePob, parsePob, MAX_XML_BYTES } from './pob-import';
import { t, plural, dateTime, noteText } from './i18n';

interface Options {
 network:TavoraSDK['network'];
 characters:{id:string;title:string;character?:Character|undefined}[];
 initial?:{id:string;build:Build}|undefined;
 load:(id:string)=>Promise<Build|null>;
 save:(build:Build)=>Promise<void>;
 onClose:()=>void;
}
export function openCharacterImport(options:Options):void {
 const dialog=document.createElement('dialog');dialog.className='character-import';
 dialog.setAttribute('aria-labelledby','character-import-title');
 dialog.innerHTML=`<form method="dialog"><div class="character-import-heading"><h2 id="character-import-title">${esc(t('menu.character'))}</h2><button value="cancel" aria-label="${esc(t('dialog.close'))}">×</button></div></form>
 <details id="character-entry" open><summary>${esc(t('character.source'))}</summary><label>${esc(t('character.sourceLabel'))}<select id="character-source"><option value="ninja">${esc(t('character.ninja'))}</option><option value="code">${esc(t('character.code'))}</option><option value="xml">${esc(t('character.xml'))}</option></select></label>
 <label id="character-text-label"><span>${esc(t('character.url'))}</span><textarea id="character-input" rows="4" spellcheck="false" placeholder="https://poe.ninja/poe2/builds/…/character/…/…"></textarea></label>
 <label id="character-file-label" hidden>${esc(t('character.xml'))}<input id="character-file" type="file" accept=".xml,text/xml,application/xml"></label>
 <p class="character-import-help">${esc(t('character.help'))}</p>
 <button id="character-read" type="button">${esc(t('dialog.preview'))}</button></details><p id="character-error" role="status" aria-live="polite"></p>
 <section id="character-preview" hidden><h3>${esc(t('character.preview'))}</h3><label>${esc(t('dialog.name'))}<input id="character-name" maxlength="200"></label><p id="character-summary"></p><ul id="character-warnings"></ul>
 <label>${esc(t('dialog.saveAs'))}<select id="character-target"><option value="">${esc(t('dialog.asNew'))}</option>${options.characters.map(c=>`<option value="${esc(c.id)}">${esc(t('dialog.update',{title:c.title}))}</option>`).join('')}</select></label><p>${esc(t('character.replace'))}</p>
 <button id="character-save" type="button">${esc(t('character.save'))}</button></section>`;
 document.body.append(dialog);
 const get=<T extends HTMLElement=HTMLElement>(selector:string)=>dialog.querySelector<T>(selector)!;
 const source=get<HTMLSelectElement>('#character-source'),input=get<HTMLTextAreaElement>('#character-input'),file=get<HTMLInputElement>('#character-file'),target=get<HTMLSelectElement>('#character-target'),read=get<HTMLButtonElement>('#character-read'),save=get<HTMLButtonElement>('#character-save'),name=get<HTMLInputElement>('#character-name'),error=get('#character-error');
 let candidate:CharacterImport|null=null,serial=0,closed=false,saving=false;
 const invalidate=()=>{serial++;candidate=null;get('#character-preview').hidden=true;error.textContent='';read.disabled=false;};
 source.onchange=()=>{invalidate();get('#character-text-label').hidden=source.value==='xml';get('#character-file-label').hidden=source.value!=='xml';get('#character-text-label span').textContent=t(source.value==='ninja'?'character.url':'character.code');input.placeholder=source.value==='ninja'?'https://poe.ninja/poe2/builds/…/character/…/…':t('character.codePlaceholder');};
 input.oninput=invalidate;file.onchange=invalidate;
 const preview=async()=>{
  const request=++serial;candidate=null;get('#character-preview').hidden=true;read.disabled=true;error.textContent=t('character.reading');
  try {
   let loaded:CharacterImport;
   if(source.value==='ninja')loaded=await importNinja(input.value,options.network);
   else {
    const chosen=file.files?.[0];
    if(source.value==='xml'&&(!chosen||chosen.size>MAX_XML_BYTES))throw Error(t('error.xmlFileTooBig'));
    const value=source.value==='xml'?await chosen!.text():input.value;
    const parsed=parsePob(await decodePob(value),source.value==='xml'?chosen!.name.replace(/\.xml$/i,''):t('character.defaultName'));
    loaded={build:parsed.build,warnings:parsed.warnings};
   }
   if(closed||request!==serial)return;
   candidate=loaded;const b=loaded.build,c=b.character!;
   name.value=options.initial?.build.character?.name||c.name;
   const active=b.stages[0]!;
   get('#character-summary').textContent=`${t('character.headline',{class:c.class,ascendancy:b.ascendancy,level:c.level})}\n${plural('character.items',active.items.length)} · ${plural('character.groups',active.skills.length)} · ${plural('character.nodes',new Set(active.passives.map(n=>n.id)).size)}\n${plural('character.setups',b.stages.length)} · ${t('character.imported',{date:dateTime(c.importedAt)})}`;
   get('#character-warnings').innerHTML=loaded.warnings.map(w=>`<li>${esc(noteText(w))}</li>`).join('');
   target.value=options.initial?.id||options.characters.find(entry=>c.url&&entry.character?.url===c.url)?.id||'';
   get('#character-preview').hidden=false;error.textContent=t('character.check');
   get<HTMLDetailsElement>('#character-entry').open=false;
   get('#character-entry summary').textContent=t('character.changeSource',{source:source.selectedOptions[0]!.textContent||''});
  } catch(e) {if(!closed&&request===serial)error.textContent=e instanceof Error?e.message:String(e);}
  finally{if(!closed&&request===serial)read.disabled=false;}
 };
 read.onclick=()=>void preview();
 save.onclick=()=>{void(async()=>{
  if(!candidate||saving)return;
  saving=true;save.disabled=true;read.disabled=true;source.disabled=true;input.disabled=true;file.disabled=true;target.disabled=true;name.disabled=true;
  try {
   const existing=target.value?await options.load(target.value):null;
   if(target.value&&!existing)throw Error(t('error.characterGone'));
   const build=prepareCharacterSave(candidate.build,name.value,existing);
   error.textContent=t('character.saving');await options.save(build);dialog.close();
  }catch(e){error.textContent=e instanceof Error?e.message:String(e);}
  finally{saving=false;for(const control of [save,read,source,input,file,target,name])control.disabled=false;}
 })();};
 // A save already in progress is committed atomically; avoid closing halfway through it.
 dialog.addEventListener('cancel',e=>{if(saving)e.preventDefault();});
 dialog.querySelector('form')!.onsubmit=e=>{if(saving)e.preventDefault();};
 dialog.onclose=()=>{closed=true;serial++;dialog.remove();options.onClose();};
 dialog.showModal();
 if(options.initial?.build.character?.url){input.value=options.initial.build.character.url;void preview();}
}
