import type { TavoraSDK } from '@tavora/sdk';
import type { Build, Character } from './model';
import { esc } from './html';
import { importNinja, prepareCharacterSave, type CharacterImport } from './character-import';
import { decodePob, parsePob, MAX_XML_BYTES } from './pob-import';

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
 dialog.innerHTML=`<form method="dialog"><div class="character-import-heading"><h2 id="character-import-title">Import character</h2><button value="cancel" aria-label="Close import">×</button></div></form>
 <details id="character-entry" open><summary>Import source</summary><label>Source<select id="character-source"><option value="ninja">poe.ninja character URL</option><option value="code">PoB export code</option><option value="xml">PoB XML file</option></select></label>
 <label id="character-text-label"><span>Character URL</span><textarea id="character-input" rows="4" spellcheck="false" placeholder="https://poe.ninja/poe2/builds/…/character/…/…"></textarea></label>
 <label id="character-file-label" hidden>PoB XML file<input id="character-file" type="file" accept=".xml,text/xml,application/xml"></label>
 <p class="character-import-help">Use a public PoE 2 character URL or an export from Path of Building PoE 2. No account sign-in needed.</p>
 <button id="character-read" type="button">Preview import</button></details><p id="character-error" role="status" aria-live="polite"></p>
 <section id="character-preview" hidden><h3>Character preview</h3><label>Name<input id="character-name" maxlength="200"></label><p id="character-summary"></p><ul id="character-warnings"></ul>
 <label>Save as<select id="character-target"><option value="">Import as new</option>${options.characters.map(c=>`<option value="${esc(c.id)}">Update ${esc(c.title)}</option>`).join('')}</select></label><p>Updates replace the saved snapshot after a successful import. Your guide builds stay separate.</p>
 <button id="character-save" type="button">Save character</button></section>`;
 document.body.append(dialog);
 const get=<T extends HTMLElement=HTMLElement>(selector:string)=>dialog.querySelector<T>(selector)!;
 const source=get<HTMLSelectElement>('#character-source'),input=get<HTMLTextAreaElement>('#character-input'),file=get<HTMLInputElement>('#character-file'),target=get<HTMLSelectElement>('#character-target'),read=get<HTMLButtonElement>('#character-read'),save=get<HTMLButtonElement>('#character-save'),name=get<HTMLInputElement>('#character-name'),error=get('#character-error');
 let candidate:CharacterImport|null=null,serial=0,closed=false,saving=false;
 const invalidate=()=>{serial++;candidate=null;get('#character-preview').hidden=true;error.textContent='';read.disabled=false;};
 source.onchange=()=>{invalidate();get('#character-text-label').hidden=source.value==='xml';get('#character-file-label').hidden=source.value!=='xml';get('#character-text-label span').textContent=source.value==='ninja'?'Character URL':'PoB export code';input.placeholder=source.value==='ninja'?'https://poe.ninja/poe2/builds/…/character/…/…':'Paste the code from PoB → Import/Export Build → Generate';};
 input.oninput=invalidate;file.onchange=invalidate;
 const preview=async()=>{
  const request=++serial;candidate=null;get('#character-preview').hidden=true;read.disabled=true;error.textContent='Reading character…';
  try {
   let loaded:CharacterImport;
   if(source.value==='ninja')loaded=await importNinja(input.value,options.network);
   else {
    const chosen=file.files?.[0];
    if(source.value==='xml'&&(!chosen||chosen.size>MAX_XML_BYTES))throw Error('Choose a PoB XML file up to 8 MB.');
    const value=source.value==='xml'?await chosen!.text():input.value;
    const parsed=parsePob(await decodePob(value),source.value==='xml'?chosen!.name.replace(/\.xml$/i,''):'PoB character');
    loaded={build:parsed.build,warnings:parsed.warnings};
   }
   if(closed||request!==serial)return;
   candidate=loaded;const b=loaded.build,c=b.character!;
   name.value=options.initial?.build.character?.name||c.name;
   const active=b.stages[0]!;
   get('#character-summary').textContent=`${c.class} · ${b.ascendancy} · Level ${c.level}\n${active.items.length} equipped items · ${active.skills.length} skill groups · ${new Set(active.passives.map(n=>n.id)).size} passive nodes\n${b.stages.length} selectable setup${b.stages.length===1?'':'s'} · Imported ${new Date(c.importedAt).toLocaleString()}`;
   get('#character-warnings').innerHTML=loaded.warnings.map(w=>`<li>${esc(w)}</li>`).join('');
   target.value=options.initial?.id||options.characters.find(entry=>c.url&&entry.character?.url===c.url)?.id||'';
   get('#character-preview').hidden=false;error.textContent='Check the character, then save.';
   get<HTMLDetailsElement>('#character-entry').open=false;
   get('#character-entry summary').textContent=source.selectedOptions[0]!.textContent+' · Change source';
  } catch(e) {if(!closed&&request===serial)error.textContent=e instanceof Error?e.message:String(e);}
  finally{if(!closed&&request===serial)read.disabled=false;}
 };
 read.onclick=()=>void preview();
 save.onclick=()=>{void(async()=>{
  if(!candidate||saving)return;
  saving=true;save.disabled=true;read.disabled=true;source.disabled=true;input.disabled=true;file.disabled=true;target.disabled=true;name.disabled=true;
  try {
   const existing=target.value?await options.load(target.value):null;
   if(target.value&&!existing)throw Error('That saved character is no longer available. Import as new instead.');
   const build=prepareCharacterSave(candidate.build,name.value,existing);
   error.textContent='Saving character…';await options.save(build);dialog.close();
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
