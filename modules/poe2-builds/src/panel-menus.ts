import {menuAction} from './controls';
import type {Build} from './model';
import {t} from './i18n';

const panels={tree:'panel.tree',skills:'panel.skills',gear:'panel.gear',guide:'panel.guide'} as const;
type PanelType=keyof typeof panels;
const descriptions={tree:'menu.openTree',skills:'menu.openSkills',gear:'menu.openGear',guide:'menu.openGuide'} as const;

export function addMenuActions(empty=false):string{
 return menuAction('import',t('menu.import'),t('menu.importText'),`id="${empty?'empty-build':'import-build'}"`)
  +menuAction('character',t('menu.character'),t('menu.characterText'),`id="${empty?'empty-character':'import-character'}"`)
  +menuAction('file',t('menu.file'),t('menu.fileText'),`id="${empty?'empty-load':'load'}"`);
}
export function panelMenuActions(build:Build|null,type:PanelType,notesOpen:boolean):string{
 const refresh=build?.character?.source==='poe.ninja'?menuAction('refresh',t('menu.refresh'),t('menu.refreshText'),'id="refresh-character"'):'';
 const url=build?.guideUrl||build?.guideText?.url;
 const source=menuAction('external',t(build?.character?'menu.viewCharacter':'menu.originalGuide'),url?t(build?.character?'menu.viewCharacterText':'menu.originalGuideText'):t('menu.noSource'),'id="source" '+(url?'':'disabled'));
 const notes=menuAction('notes',t(notesOpen?'menu.hideNotes':'menu.showNotes'),t(notesOpen?'menu.hideNotesText':'menu.showNotesText'),'id="toggle-excerpts" '+(type==='guide'||!build?'hidden':''));
 const links=build?`<nav aria-label="${t('menu.panels')}">${(Object.keys(panels) as PanelType[]).filter(id=>id!==type).map(id=>menuAction(id,t('menu.open',{panel:t(panels[id])}),t(descriptions[id]),`data-open="${id}"`)).join('')}</nav>`:'';
 const update=build?.guideImport?menuAction('refresh',t('menu.update'),t('menu.updateText',{source:build.guideImport.source}),'id="refresh-guide"'):'';
 const exportFile=build?menuAction('export',t(build.character?'menu.exportCharacter':'menu.exportBuild'),t('menu.exportText'),'id="export-build"'):'';
 return refresh+update+source+exportFile+notes+links;
}
