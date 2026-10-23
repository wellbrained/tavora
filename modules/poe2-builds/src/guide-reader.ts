import {visibilitySwitch,collapseIcon} from './controls';
import type { Build } from './model';
import type { View } from './view-state';
import { readerChapters, type ReaderChapter } from './guide-chapters';
import { esc } from './presentation';
import { guideTextMarkup } from './guide-text';
import { t } from './i18n';

export interface GuideGroup { key: string; label: string; chapters: { index: number; label: string }[] }
/** Older files encode the variant in the title. Match only exact known suffixes;
 * unclassified chapters stay in General, with their original wording intact. */
export function guideGroups(build: Build, chapters: ReaderChapter[] = readerChapters(build)): GuideGroup[] {
 const general: GuideGroup={key:'general',label:t('guide.general'),chapters:[]};
 const variants=build.stages.map((stage,i)=>({key:'variant-'+i,label:stage.label||stage.name,chapters:[]} as GuideGroup));
 const candidates=variants.filter(v=>v.label).sort((a,b)=>b.label.length-a.label.length);
 chapters.forEach((chapter,index)=>{
  const group=candidates.find(v=>chapter.title.toLowerCase().endsWith(' · '+v.label.toLowerCase()));
  let label=group?chapter.title.slice(0,-group.label.length-3).trim():chapter.title;
  if(group){const context=chapter.context;label=context==='gear'?t('guide.equipment'):context==='skills'?t('guide.skills'):context==='tree'?t('guide.passiveTree'):/^build variants?$/i.test(label)?t('guide.overview'):label;}
  (group||general).chapters.push({index,label});
 });
 return [general,...variants].filter(g=>g.chapters.length);
}

export function guideReaderMarkup(build: Build, view: View): string {
 const chapters=readerChapters(build),groups=guideGroups(build,chapters);
 if(!chapters.length)return `<p>${esc(t('guide.empty'))}</p>`;
 const index=Math.min(view.section,chapters.length-1),group=groups.find(g=>g.chapters.some(c=>c.index===index))!;
 return `<div class="guide-reader ${view.guideSidebar?'':'nav-collapsed'}">
  <div class="guide-controls">
   ${visibilitySwitch('guide-nav-toggle',esc(t('guide.groups')),view.guideSidebar,'guide-navigation')}
   <select id="guide-group" aria-label="${esc(t('guide.group'))}">${groups.map(g=>`<option value="${g.key}" ${g===group?'selected':''}>${esc(g.label)}</option>`).join('')}</select>
   <button id="guide-toggle-all">${collapseIcon(!chapters.some(s=>view.guideChapters[s.key]??view.guideExpanded))}${chapters.some(s=>view.guideChapters[s.key]??view.guideExpanded)?esc(t('guide.collapseAll')):esc(t('guide.expandAll'))}</button>
  </div>
  <nav id="guide-navigation" aria-label="${esc(t('guide.groupList'))}">${groups.map(g=>`<button data-guide-group="${g.key}" aria-current="${g===group}">${esc(g.label)}</button>`).join('')}</nav>
  <div class="guide-tabs" role="tablist" aria-label="${esc(t('guide.chapters'))}">${groups.flatMap(g=>g.chapters.map(c=>`<button role="tab" id="chapter-tab-${c.index}" data-tab-group="${g.key}" data-section="${c.index}" aria-controls="section-${c.index}" aria-selected="${c.index===index}" tabindex="${c.index===index?0:-1}" ${g===group?'':'hidden'}>${esc(c.label)}</button>`)).join('')}</div>
  <div class="guide-article">${chapters.map((s,i)=>`<details class="guide-chapter" role="tabpanel" aria-labelledby="chapter-tab-${i}" id="section-${i}" data-chapter="${s.key}" ${(view.guideChapters[s.key]??view.guideExpanded)?'open':''} ${i===index?'':'hidden'}>
   <summary><span class="control-chevron" aria-hidden="true"></span><h2>${esc(s.title)}</h2>${s.buildData?`<span class="chapter-source">${esc(t('guide.buildData'))}</span>`:''}</summary>
   <div class="chapter-body">${s.text?`<div class="original-text">${guideTextMarkup(s.text)}</div>`:''}${s.links?.map(link=>`<button class="chapter-link" data-reference="${esc(link.url)}">${esc(link.label)}</button>`).join('')||''}</div>
  </details>`).join('')}</div>
 </div>`;
}
