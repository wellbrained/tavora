import { enrichItem, buildDisplayTitle } from './item-data.js';
import {itemMetadata,questChoices,questAdvice} from './item-metadata.js';
import { resolveItemIdentity } from './item-identity.js';
// Portable v1 validation, independent of host storage and UI.
const FORMAT = 'tavora.build', VERSION = 1, MAX_BYTES = 24 * 1024 * 1024;
const text = (v, max = 200000) => typeof v === 'string' && v.length <= max ? v : '';
const plain = v => v && typeof v === 'object' && !Array.isArray(v);
/** Guide sites the URL importer reads, with the guide addresses each accepts. */
const GUIDE_SOURCES = { Mobalytics: { host: 'mobalytics.gg', path: /^\/poe-2\/builds\/[a-z0-9-]+\/?$/ }, 'PoE Vault': { host: 'www.poe-vault.com', path: /^\/poe2\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+\/?$/ } };
const url = v => { if (!v)
    return ''; try {
    const p = new URL(v);
    return ['https:', 'http:'].includes(p.protocol) && !p.username && !p.password ? p.href : '';
}
catch {
    return '';
} };
const stringList = (v, max = 100) => Array.isArray(v) ? v.slice(0, max).filter(x => typeof x === 'string').map(x => text(x)) : [];
function guideText(value) {
    if (!plain(value))
        return null;
    const out = { url: url(value.url), tree: text(value.tree), gear: text(value.gear), skills: text(value.skills), items: {}, gems: {}, crafting: {} };
    for (const field of ['items', 'gems'])
        if (plain(value[field]))
            for (const [key, v] of Object.entries(value[field]).slice(0, 1000))
                if (typeof v === 'string')
                    out[field][key] = text(v);
    if (plain(value.crafting))
        for (const [key, v] of Object.entries(value.crafting).slice(0, 200))
            if (plain(v))
                out.crafting[key] = { label: text(v.label, 1000), text: text(v.text) };
    out.stageNotes = undefined;
    if (plain(value.stageNotes)) {
        out.stageNotes = {};
        for (const [index, notes] of Object.entries(value.stageNotes).slice(0, 100)) {
            if (!/^(0|[1-9][0-9]?)$/.test(index) || !plain(notes)) continue;
            out.stageNotes[index] = {};
            for (const context of ['gear', 'skills', 'tree'])
                if (typeof notes[context] === 'string') out.stageNotes[index][context] = text(notes[context]);
        }
    }
    // Additional imported guide sections can travel unchanged even before this UI places them.
    if (Array.isArray(value.sections) && value.sections.some(s => !plain(s) || typeof s.text !== 'string' || s.text.length > 2000000))
        throw Error('A guide section is invalid or too large.');
    if (Array.isArray(value.sections))
        out.sections = value.sections.map(s => ({ title: text(s.title, 1000), text: text(s.text, 2000000), context: ['tree', 'gear', 'skills', 'overview'].includes(s.context) ? s.context : 'overview' }));
    return { ...JSON.parse(JSON.stringify(value)), ...out };
}
function checkedGem(g, depth = 0) {
    if (!plain(g) || typeof g.id !== 'string' || typeof g.name !== 'string' || depth > 5)
        throw Error('The build contains invalid gem data.');
    const out = { id: text(g.id, 1500), name: text(g.name, 1500), attributes: stringList(g.attributes, 3).filter(a => ['Strength', 'Dexterity', 'Intelligence'].includes(a)), isSupport: g.isSupport === true, lineage: g.lineage === true, tags: stringList(g.tags, 100) };
    if (Number.isInteger(g.level) && g.level > 0 && g.level <= 100)
        out.level = g.level;
    if (Number.isFinite(g.quality) && g.quality >= 0 && g.quality <= 100)
        out.quality = g.quality;
    if (Array.isArray(g.levels))
        out.levels = g.levels.slice(0, 2).filter(n => Number.isInteger(n) && n > 0 && n <= 100);
    if (Array.isArray(g.supports)) {
        if (g.supports.length > 100)
            throw Error('A gem group is too large.');
        out.supports = g.supports.map(s => checkedGem(s, depth + 1));
    }
    return out;
}
export function validate(document) {
    if (!plain(document) || document.format !== FORMAT)
          throw Error('Choose a .tavora-build.json file exported by the prototype. This alpha does not load raw .build or ZIP files.');
    if (document.formatVersion !== VERSION)
        throw Error('This file uses an unsupported Tavora build format version. The file was left unchanged.');
    if (typeof document.buildId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(document.buildId))
        throw Error('The build file has an invalid identity.');
    const b = document.build;
    if (!plain(b) || !text(b.title, 2000) || !Array.isArray(b.stages) || !b.stages.length || b.stages.length > 100)
        throw Error('The build file has invalid or missing variants.');
    if (b.treeVersion && !['0.4', '0.5'].includes(b.treeVersion))
        throw Error('This tree version is not bundled in this alpha.');
    const out = { id: 'saved-' + document.buildId, fileId: document.buildId, title: buildDisplayTitle(text(b.title, 2000)), shortTitle: text(b.shortTitle, 2000) || text(b.title, 2000), source: text(b.source, 2000) || 'Saved Tavora build', kind: b.kind === 'leveling' ? 'leveling' : 'endgame', version: text(b.version, 2000), treeVersion: ['0.4', '0.5'].includes(b.treeVersion) ? b.treeVersion : '0.5', ascendancy: text(b.ascendancy, 2000) || 'Ascendancy', guideUrl: url(b.guideUrl), requestedUrl: url(b.requestedUrl), video: url(b.video), importerVersion: text(b.importerVersion, 100), importNotes: stringList(b.importNotes, 200), downloads: [], stages: [], guideText: guideText(document.guideText || b.guideText) };
    out.questSelections=questChoices(b.questSelections);
    if(typeof b.guideExport==='string'&&b.guideExport.length<=5*1024*1024)out.guideExport=b.guideExport;
    const source=plain(b.guideImport)&&Object.hasOwn(GUIDE_SOURCES,b.guideImport.source)&&GUIDE_SOURCES[b.guideImport.source];
    if(source&&text(b.guideImport.documentId,200)&&Number.isFinite(Date.parse(b.guideImport.importedAt))){
        const u=new URL(b.guideImport.url);
        if(u.protocol!=='https:'||u.hostname!==source.host||u.port||u.username||u.password||!source.path.test(u.pathname))throw Error('The guide source URL is invalid.');
        out.guideImport={source:b.guideImport.source,url:u.href,documentId:b.guideImport.documentId,revision:text(b.guideImport.revision,200),importedAt:new Date(b.guideImport.importedAt).toISOString(),variantIds:stringList(b.guideImport.variantIds,100)};
    }
    out.questStats=stringList(b.questStats,100);
    if (b.character !== undefined) {
        const c=b.character;
        if (!plain(c) || !text(c.name,200) || !['poe.ninja','PoB'].includes(c.source) || !Number.isInteger(c.level) || c.level<1 || c.level>100 || !text(c.class,100) || !Number.isFinite(Date.parse(c.importedAt)))
            throw Error('The character identity is invalid.');
        out.character={name:c.name,class:c.class,level:c.level,source:c.source,importedAt:new Date(c.importedAt).toISOString()};
        for(const field of ['account','league']) if(text(c[field],200))out.character[field]=c[field];
        if(c.source==='poe.ninja'){
            const u=new URL(c.url);
            if(u.protocol!=='https:'||u.hostname!=='poe.ninja'||u.port||u.username||u.password||!/^\/poe2\/builds\/[^/]+\/character\/[^/]+\/[^/]+\/?$/.test(u.pathname))throw Error('The character source URL is invalid.');
            out.character.url=u.origin+u.pathname;
        }
        if(typeof b.characterExport==='string' && b.characterExport.length<=8*1024*1024)out.characterExport=b.characterExport;
    }
    for (const s of b.stages) {
        if (!plain(s) || !Array.isArray(s.passives) || !Array.isArray(s.skills) || !Array.isArray(s.items) || s.passives.length > 10000 || s.skills.length > 1000 || s.items.length > 500)
            throw Error('The build contains invalid or oversized planner data.');
        const stage = { questRecommendations:questAdvice(s.questRecommendations), name: text(s.name, 2000) || text(s.label, 2000) || 'Variant', label: text(s.label, 2000) || text(s.name, 2000) || 'Variant', author: text(s.author, 2000), link: url(s.link) || out.guideUrl, passives: s.passives.map(n => { if (!plain(n) || !/^\d+$/.test(String(n.id)) || ![0, 1, 2].includes(n.weapon ?? 0))
                throw Error('The build contains invalid passive allocations.'); return { id: String(n.id), weapon: n.weapon ?? 0 }; }), skills: s.skills.map(g => checkedGem(g)), items: s.items.map(i => {
                if (!plain(i))
                    throw Error('The build contains an invalid item.');
                const item = { inventory_id: text(i.inventory_id, 500), name: text(i.name, 2000), base: text(i.base, 2000), mods: stringList(i.mods, 500), rarity: ['normal', 'magic', 'rare', 'unique', 'unknown'].includes(i.rarity) ? i.rarity : 'unknown', reference: i.reference === true, exact: i.exact === true, slot_x: Number.isFinite(i.slot_x) ? i.slot_x : 0, slot_y: Number.isFinite(i.slot_y) ? i.slot_y : 0 };
                for (const key of ['unique_name', 'sourceBase', 'sourceUnique', 'category', 'sourceLabel'])
                    if (typeof i[key] === 'string')
                        item[key] = text(i[key], 2000);
                for (const key of ['level', 'quality', 'implicitCount'])
                    if (Number.isFinite(i[key]))
                        item[key] = i[key];
                if (Array.isArray(i.level_interval))
                    item.level_interval = i.level_interval.slice(0, 2).map(Number);
                if (plain(i.sourceStats))
                    item.sourceStats = Object.fromEntries(Object.entries(i.sourceStats).slice(0, 1000).filter(([, v]) => ['number', 'string', 'boolean'].includes(typeof v)));
                if(typeof i.sourceText==='string')item.sourceText=text(i.sourceText,100000);
                if(Array.isArray(i.sourceModifiers))item.sourceModifiers=i.sourceModifiers.slice(0,100).filter(plain).map(m=>({kind:text(m.kind,100),id:text(m.id,500),stats:plain(m.stats)?Object.fromEntries(Object.entries(m.stats).slice(0,100).filter(([,n])=>typeof n==='number'&&Number.isFinite(n))):{}}));
                return enrichItem({...resolveItemIdentity(item),...itemMetadata(i)});
            }) };
        if(out.character){
            if(['active','gear','skills','tree'].includes(s.characterProfile))stage.characterProfile=s.characterProfile;
            if(['0.4','0.5'].includes(s.treeVersion))stage.treeVersion=s.treeVersion;
            if(text(s.ascendancy,200))stage.ascendancy=s.ascendancy;
            if([1,2].includes(s.weaponSet))stage.weaponSet=s.weaponSet;
        }
        else if(['skills','tree'].includes(s.characterProfile))stage.characterProfile=s.characterProfile;
        if(text(s.ascendancy,200))stage.ascendancy=s.ascendancy;
        out.stages.push(stage);
    }
    out.defaultStage = Number.isInteger(b.defaultStage) && b.defaultStage >= 0 && b.defaultStage < out.stages.length ? b.defaultStage : 0;
    for (const d of (Array.isArray(b.downloads) ? b.downloads : []).slice(0, 20))
        if (plain(d) && typeof d.url === 'string' && d.url.length <= MAX_BYTES && /^data:(application\/(?:octet-stream|json|zip)|text\/(?:plain|xml));base64,[a-zA-Z0-9+/=\r\n]*$/.test(d.url))
            out.downloads.push({ label: text(d.label, 2000), filename: text(d.filename, 1000).replace(/[\\/]/g, '_'), url: d.url });
    return out;
}
