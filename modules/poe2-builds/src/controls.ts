export function visibilitySwitch(id:string,label:string,checked:boolean,controls:string):string{
 return `<label class="visibility-switch"><input id="${id}" type="checkbox" role="switch" aria-controls="${controls}" ${checked?'checked':''}><span class="switch-track" aria-hidden="true"></span><span>${label}</span></label>`;
}
export function collapseIcon(expand:boolean):string{return `<svg class="collapse-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 12h10${expand?'M12 7v10':''}"/></svg>`;}
import { esc } from './html';

type MenuIcon = 'import'|'character'|'file'|'export'|'external'|'refresh'|'notes'|'tree'|'skills'|'gear'|'guide';
const iconPaths:Record<string,string>={
 import:'M14 3h7v7M21 3l-9 9M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5',
 character:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M19 8v6M16 11h6',
 file:'M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v1M3 7h17a1 1 0 0 1 1 1l-2 11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2L3 7',
 export:'M12 3v12M7 10l5 5 5-5M4 21h16',
 external:'M14 3h7v7M21 3l-9 9M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5',
 refresh:'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1',
 notes:'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
};
/** Icons and attributes come from the module, never from imported data. */
export function menuAction(icon:MenuIcon,label:string,description:string,attributes=''):string{
 const art=['tree','skills','gear','guide'].includes(icon)?`<img src="assets/icons/panel-${icon}.png" alt="">`:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${iconPaths[icon]}"/>${icon==='character'?'<circle cx="9" cy="7" r="4"/>':''}</svg>`;
 return `<button class="menu-action" type="button" ${attributes}><span class="menu-icon" aria-hidden="true">${art}</span><span class="menu-copy"><span class="menu-label">${esc(label)}</span><span class="menu-description">${esc(description)}</span></span></button>`;
}
