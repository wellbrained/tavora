import {menuAction} from './controls';
import type {Build} from './model';

const panels={tree:'Tree',skills:'Skills',gear:'Gear',guide:'Guide'} as const;
type PanelType=keyof typeof panels;
const descriptions={tree:"Show this build's passive tree in a panel.",skills:"Show this build's gems in a panel.",gear:"Show this build's equipment in a panel.",guide:"Read this build's saved guide text."};

export function addMenuActions(empty=false):string{
 return menuAction('import','Import build','Use a Mobalytics or PoE Vault guide URL, with an optional build file.',`id="${empty?'empty-build':'import-build'}"`)
  +menuAction('character','Import character','Use your poe.ninja character or PoB export.',`id="${empty?'empty-character':'import-character'}"`)
  +menuAction('file','Load build file','Open a saved .tavora-build.json file.',`id="${empty?'empty-load':'load'}"`);
}
export function panelMenuActions(build:Build|null,type:PanelType,notesOpen:boolean):string{
 const refresh=build?.character?.source==='poe.ninja'?menuAction('refresh','Refresh character','Fetch a newer snapshot from poe.ninja.','id="refresh-character"'):'';
 const url=build?.guideUrl||build?.guideText?.url;
 const source=menuAction('external',build?.character?'View character':'Original guide',url?(build?.character?'Open this character on poe.ninja.':"Read this build on the author's website."):'This saved build has no source link.','id="source" '+(url?'':'disabled'));
 const notes=menuAction('notes',notesOpen?'Hide all notes':'Show all notes',notesOpen?'Collapse notes in this panel.':'Expand notes in this panel.','id="toggle-excerpts" '+(type==='guide'||!build?'hidden':''));
 const links=build?`<nav aria-label="Open build panel">${(Object.keys(panels) as PanelType[]).filter(id=>id!==type).map(id=>menuAction(id,'Open '+panels[id],descriptions[id],`data-open="${id}"`)).join('')}</nav>`:'';
 const update=build?.guideImport?menuAction('refresh','Update guide',`Preview the latest ${build.guideImport.source} guide before saving.`,'id="refresh-guide"'):'';
 const exportFile=build?menuAction('export',build.character?'Export character':'Export build','Save it as a file in Downloads/Tavora.','id="export-build"'):'';
 return refresh+update+source+exportFile+notes+links;
}
