export function visibilitySwitch(id:string,label:string,checked:boolean,controls:string):string{
 return `<label class="visibility-switch"><input id="${id}" type="checkbox" role="switch" aria-controls="${controls}" ${checked?'checked':''}><span class="switch-track" aria-hidden="true"></span><span>${label}</span></label>`;
}
export function collapseIcon(expand:boolean):string{return `<svg class="collapse-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 12h10${expand?'M12 7v10':''}"/></svg>`;}
