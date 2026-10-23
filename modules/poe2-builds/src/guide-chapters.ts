import { guideSections, type Build, type GuideSection } from './model';
import { t, dateTime, noteText } from './i18n';

export interface ReaderChapter extends GuideSection {
    key: string;
    buildData?: boolean;
    links?: { label: string; url: string }[];
}

function safeLink(value: string | undefined): string | undefined {
    try {
        const parsed = new URL(value || '');
        if (['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password) return parsed.href;
    } catch { /* An absent/invalid reference does not create a link. */ }
    return undefined;
}

/** Original text stays first, unchanged. Append only information present in the file.
 * These chapters are derived locally, so existing portable builds need no migration. */
export function readerChapters(build: Build): ReaderChapter[] {
    const original = guideSections(build.guideText, build.stages);
    const chapters: ReaderChapter[] = original.map((section, i) => ({ ...section, key: `guide-${i}` }));
    if (build.guideText?.sections?.length) {
        const saved = guideSections({ ...build.guideText, sections: [] }, build.stages);
        for (const [i, section] of saved.entries())
            if (typeof section.text === 'string' && section.text.trim() && !original.some(s => s.text.includes(section.text.trim())))
                chapters.push({ ...section, key: `saved-${i}` });
    }
    const append = (key: string, title: string, text: string, context: string) => {
        if (text) chapters.push({ key, title, text, context, buildData: true });
    };
    const choices=build.questSelections||[];
    if(choices.length)append('quest-rewards',t('guide.questRewards'),t(build.character?'guide.characterChoices':'guide.recommendations')+'\n\n'+choices.map(q=>[q.act,q.area,q.quest,q.reward].filter(Boolean).join(' · ')).join('\n\n'),'overview');
    else if(build.questStats?.length)append('quest-rewards',t('guide.questRewards'),t('guide.characterBonuses')+'\n\n'+build.questStats.join('\n'),'overview');
    build.stages.forEach((stage,i)=>{if(stage.questRecommendations?.length)append('quest-rewards-'+i,t('guide.questRewards')+' · '+stage.label,stage.questRecommendations.map(q=>q.text).join('\n\n'),'overview');});
    const information = [build.title, build.source ? t('guide.source', { source: build.source }) : '', build.version ? t('guide.version', { version: build.version }) : '',
        build.treeVersion ? t('guide.tree', { version: build.treeVersion }) : '', build.ascendancy,
        ...build.stages.filter(s => s.author).map(s => `${s.label} · ${s.author}`)].filter(Boolean);
    if(build.character){const c=build.character;information.push(t('guide.character',{name:c.name}),t('guide.classLevel',{class:c.class,level:c.level}),t('guide.imported',{date:dateTime(c.importedAt)}),...(build.importNotes||[]).map(noteText));}
    append('build-information', t('guide.information'), information.join('\n'), 'overview');
    const video = safeLink(build.video);
    if (video) chapters.push({ key: 'build-video', title: t('guide.video'), text: '', links: [{ label: t('guide.openVideo'), url: video }], buildData: true });
    const references = new Map<string, string>();
    for (const stage of build.stages) {
        const link = safeLink(stage.link);
        if (link && link !== safeLink(build.guideUrl) && link !== safeLink(build.guideText?.url)) references.set(link, stage.label);
    }
    if (references.size) chapters.push({ key: 'build-references', title: t('guide.references'), text: '', links: [...references].map(([url, label]) => ({ url, label: `${label} ↗` })), buildData: true });
    return chapters;
}
