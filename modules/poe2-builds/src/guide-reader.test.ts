import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { validate } from './validate.js';
import { portable } from './model';
import { readerChapters } from './guide-chapters';
import { guideReaderMarkup, guideGroups } from './guide-reader';
import { restoreView } from './view-state';

function fixture() {
    return validate({format:'tavora.build',formatVersion:1,buildId:'guide-test',build:{title:'Test build',source:'Test source',version:'0.5',treeVersion:'0.5',ascendancy:'Deadeye',video:'https://example.org/video',guideUrl:'https://example.org/guide',importNotes:['Saved import note.'],stages:[{label:'Early',author:'Author',link:'https://example.org/planner',passives:[],skills:[{id:'ice',name:'Ice Shot',isSupport:false,attributes:['Dexterity'],level:20,quality:12,tags:['Attack','Projectile'],levels:[31,100],supports:[{id:'support',name:'Support',isSupport:true,attributes:['Strength'],level:2,quality:0}]}],items:[{inventory_id:'Weapon1',name:'Crafted bow',base:'Warmonger Bow',rarity:'rare',quality:20,sourceStats:{physicalDps:123},mods:['An original modifier']}]}]},guideText:{sections:[{title:'Original guide',text:'Original <unchanged> wording.',context:'overview'}],gems:{ice:'A saved skill note outside the sections.'}}});
}

it('keeps original chapters unchanged and adds saved facts, notes and safe media references',()=>{
    const build=fixture(),before=JSON.stringify(build.guideText),chapters=readerChapters(build);
    expect(chapters[0]).toMatchObject({title:'Original guide',text:'Original <unchanged> wording.'});
    expect(JSON.stringify(build.guideText)).toBe(before);
    expect(chapters.some(c=>c.text==='A saved skill note outside the sections.')).toBe(true);
    expect(chapters.some(c=>['build-skills','build-equipment','build-import'].includes(c.key))).toBe(false);
    expect(build.importNotes).toEqual(['Saved import note.']);
    expect(build.stages[0]!.skills[0]!.quality).toBe(12);
    expect(build.stages[0]!.items[0]!.sourceStats).toEqual({physicalDps:123});
    expect(chapters.find(c=>c.key==='build-video')?.links?.[0]?.url).toBe('https://example.org/video');
    expect(chapters.find(c=>c.key==='build-references')?.links).toHaveLength(1);
});

it('does not duplicate saved notes already in original sections or fabricate missing values',()=>{
    const build=fixture();build.guideText!.gems={ice:'Original <unchanged> wording.'};
    delete build.stages[0]!.skills[0]!.level;delete build.stages[0]!.skills[0]!.quality;
    build.stages[0]!.skills[0]!.supports=[];delete build.video;build.stages[0]!.link=build.guideUrl;
    const chapters=readerChapters(build);
    expect(chapters.filter(c=>c.key.startsWith('saved-'))).toHaveLength(0);
    expect(chapters.some(c=>c.key==='build-skills')).toBe(false);
    expect(chapters.some(c=>c.key==='build-video'||c.key==='build-references')).toBe(false);
    build.video='javascript:alert(1)';expect(readerChapters(build).some(c=>c.key==='build-video')).toBe(false);
});

it('preserves supplied gem quality and reader state through independent round trips',()=>{
    const build=validate(JSON.parse(JSON.stringify(portable(fixture()))));
    expect(build.stages[0]!.skills[0]!.quality).toBe(12);
    expect(build.stages[0]!.skills[0]!.supports![0]!.quality).toBe(0);
    const view=restoreView({guideSidebar:false,guideExpanded:false,guideChapters:{'guide-0':true,bad:42}});
    expect(restoreView(JSON.parse(JSON.stringify(view)))).toEqual(view);
    expect(view.guideChapters).toEqual({'guide-0':true});
    expect(restoreView(null)).toMatchObject({guideSidebar:true,guideExpanded:true,guideChapters:{}});
});

it('renders individual disclosures, all toggle, sidebar control and escaped dropdown labels',()=>{
    const markup=guideReaderMarkup(fixture(),restoreView({guideSidebar:false,guideExpanded:false,guideChapters:{'guide-0':true}}));
    expect(markup).toContain('nav-collapsed');expect(markup).toContain('aria-label="Guide group"');expect(markup).toContain('role="switch" aria-controls="guide-navigation"');
    expect(markup).toContain('data-chapter="guide-0" open');expect(markup).not.toContain('data-chapter="build-skills"');
    expect(markup).toContain('Original &lt;unchanged&gt; wording.');expect(markup).not.toContain('Original <unchanged> wording.');
    expect(markup).toContain('Build data');expect(markup).toContain('data-reference="https://example.org/video"');
});

it('keeps every supplied guide section first and unchanged when the smoke fixture is present',()=>{
    const file=process.env['POE2_SMOKE_FILE'];if(!file)return;
    const build=validate(JSON.parse(readFileSync(file,'utf8'))),original=build.guideText!.sections!,chapters=readerChapters(build);
    expect(chapters.slice(0,original.length).map(({key,...s})=>s)).toEqual(original);
    expect(chapters.some(c=>['build-skills','build-equipment','build-import'].includes(c.key))).toBe(false);
});

it('groups exact known variant suffixes and gives each chapter a short tab label',()=>{
 const build=fixture();build.stages.push({...build.stages[0]!,label:'non-crit Midgame'});
 build.guideText!.sections=[
  {title:'Build Overview',text:'Unchanged overview'},
  {title:'Build variants · Early',text:'Early overview',context:'overview'},
  {title:'Equipment · Early',text:'Original equipment',context:'gear'},
  {title:'Skill Gems · Early',text:'Original skills',context:'skills'},
  {title:'Passive Tree · non-crit Midgame',text:'Original tree',context:'tree'},
  {title:'Equipment · Unknown variant',text:'Must stay in General'},
 ];
 const groups=guideGroups(build);
 expect(groups.map(g=>g.label)).toEqual(['General','Early','non-crit Midgame']);
 expect(groups[1]!.chapters.map(c=>c.label)).toEqual(['Overview','Equipment','Skills']);
 expect(groups[2]!.chapters.map(c=>c.label)).toEqual(['Passive Tree']);
 expect(groups[0]!.chapters.some(c=>c.label==='Equipment · Unknown variant')).toBe(true);
 const markup=guideReaderMarkup(build,restoreView({section:3}));
 expect(markup).toContain('value="variant-0" selected');
 expect(markup).toContain('data-section="3" aria-controls="section-3" aria-selected="true"');
 expect(markup).toContain('Original skills');expect(markup).toContain('Original equipment');
});
