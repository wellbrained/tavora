import { connect, type TavoraSDK, type TavoraTheme } from '@tavora/sdk';
import { validate } from './validate.js';
import { guideSections, guideSectionIndex, slots, MAX_FILE_BYTES, type Build, type Gem, type Stage } from './model';
import { restoreView } from './view-state';
import { GuideLinks } from './guide-links';
import { BuildRepository } from './repository';
import { createTree } from './tree.js';
import trees from './trees.json';
import './style.css';
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const names = { tree: 'Tree', skills: 'Skills', gear: 'Gear', guide: 'Guide' } as const;
type PanelType = keyof typeof names;
let sdk: TavoraSDK, repository: BuildRepository, type: PanelType = 'tree', view = restoreView(null), build: Build | null = null;
let guideLinks: GuideLinks;
let library: {
    id: string;
    title: string;
}[] = [], tree: ReturnType<typeof createTree> | null = null, ascendancy: ReturnType<typeof createTree> | null = null, request = 0;
const treeState = { tree: 0, weapon: 'all', search: '', changes: false };
let importing = false;
function report(e: unknown) { $('#status').textContent = e instanceof Error ? e.message : String(e); }
function applyTheme(theme: TavoraTheme) { for (const [key, value] of Object.entries(theme.tokens))
    document.documentElement.style.setProperty('--' + key, value); for (const [key, value] of Object.entries(theme.colors))
    document.documentElement.style.setProperty('--host-' + key, value); }
function stage(): Stage { return build!.stages[view.stage]!; }
let stateWrites = Promise.resolve();
function remember() { const snapshot = { ...structuredClone(view) }, content = build && view.build ? { id: view.build, title: build.title.slice(0, 200) } : null; stateWrites = stateWrites.catch(() => { }).then(async () => { await sdk.panel.setState(snapshot); await sdk.panel.setContent(content); }); return stateWrites; }
async function refreshLibrary() { library = (await repository.list()).map(d => ({ id: d.id, title: d.title })).sort((a, b) => a.title.localeCompare(b.title)); }
async function show(id: string | null, index?: number) { const current = ++request, loaded = id ? await repository.get(id) : null; if (current !== request)
    return; const same = view.build === id; build = loaded; view.build = id; view.stage = Math.max(0, Math.min(index ?? loaded?.defaultStage ?? 0, (loaded?.stages.length ?? 1) - 1)); if (!same) { view.section = 0; view.disclosures = {}; } treeState.tree = view.stage; treeState.weapon = view.weapon; treeState.search = view.search; await remember(); render(); }
function excerpt(text: string | undefined, key: string = type) { const section = guideSectionIndex(guideSections(build!.guideText, build!.stages), type, text); return text ? `<details class="excerpt" data-note="${esc(key)}" ${(view.disclosures[key] ?? view.notes) ? 'open' : ''}><summary>Notes</summary><p>${esc(text)}</p><button data-open="guide" data-guide-section="${section}">Read in Guide ↗</button></details>` : ''; }
function gem(g: Gem) { return `<span class="gem gem-${esc(g.attributes?.[0]?.toLowerCase() || 'neutral')} ${g.lineage ? 'lineage' : ''}" title="${esc(g.attributes?.join(' / ') || 'Attribute not available')}">${esc(g.name)}</span>`; }
function skillsMarkup() { return excerpt(build!.guideText?.skills) + stage().skills.map(g => `<article><h2>${gem(g)}</h2>${g.levels ? `<small>From level ${g.levels[0]}</small>` : ''}<div class="supports">${(g.supports || []).map(s => `${s.isSupport === false ? '<span class="socketed">Socketed skill</span>' : ''}${gem(s)}`).join('')}</div>${excerpt(build!.guideText?.gems?.[g.id], 'gem:' + g.id)}</article>`).join(''); }
function gearMarkup() { return excerpt(build!.guideText?.gear) + (stage().items.length ? stage().items.map(i => `<article><small>${esc(slots[i.inventory_id] || i.inventory_id)}</small><h2 class="rarity-${esc(i.rarity || 'unknown')}">${esc(i.name)}</h2>${i.base ? `<p class="muted">${esc(i.base)}</p>` : ''}<small>${i.rarity && i.rarity !== 'unknown' ? esc(i.rarity) : 'Rarity not provided'}</small><p class="mods">${i.mods.map(esc).join('<br>')}</p>${i.reference ? '<small>Reference ranges · exact rolls not exported</small>' : ''}${excerpt(build!.guideText?.items?.[i.inventory_id], 'item:' + i.inventory_id)}</article>`).join('') : '<p>No equipment data in this variant.</p>'); }
function guideMarkup() { const sections = guideSections(build!.guideText, build!.stages); return sections.length ? `<div class="guide-reader"><select id="guide-section" aria-label="Guide section">${sections.map((s, i) => `<option value="${i}" ${i === view.section ? 'selected' : ''}>${esc(s.title)}</option>`).join('')}</select><nav aria-label="Guide sections">${sections.map((s, i) => `<button data-section="${i}">${esc(s.title)}</button>`).join('')}</nav><div class="guide-article">${sections.map((s, i) => `<section id="section-${i}" tabindex="-1"><h2>${esc(s.title)}</h2><div class="original-text">${esc(s.text)}</div></section>`).join('')}</div></div>` : '<p>No guide text is saved in this build.</p>'; }
function nodes() { return (trees as Record<string, unknown[]>)[build?.treeVersion || '0.5'] || []; }
function missingNodes() { const ids = new Set(nodes().map(n => (n as {
    id: string;
}).id)); return stage().passives.filter(n => !ids.has(n.id)).length; }
function treeMarkup() { return excerpt(build!.guideText?.tree) + `<div class="tree-controls"><input id="search" placeholder="Find a passive…" aria-label="Search passives" value="${esc(treeState.search)}"><button popovertarget="ascendancy-view">${esc(build!.ascendancy || 'Ascendancy')} ▾</button><select id="weapon" aria-label="Weapon allocation"><option value="all">Both sets</option><option value="1" ${treeState.weapon === '1' ? 'selected' : ''}>Set 1 · red</option><option value="2" ${treeState.weapon === '2' ? 'selected' : ''}>Set 2 · green</option></select></div><div class="tree-body"><canvas tabindex="0" aria-label="Passive tree: drag to pan, scroll to zoom"></canvas><div class="node-tooltip" hidden></div><div class="tree-buttons"><button id="minus" aria-label="Zoom out">−</button><button id="fit">Fit build</button><button id="plus" aria-label="Zoom in">+</button></div></div><details class="tree-info"><summary>Tree info</summary><p>${stage().passives.length} nodes · tree ${esc(build!.treeVersion)}. Scroll to zoom, drag to pan, click to inspect. ${missingNodes()} unresolved allocated nodes.</p></details><div id="ascendancy-view" popover><h2>${esc(build!.ascendancy || 'Ascendancy')}</h2><div class="tree-body"><canvas tabindex="0" aria-label="Ascendancy tree"></canvas><div class="node-tooltip" hidden></div></div><button popovertarget="ascendancy-view" popovertargetaction="hide">Close</button></div>`; }
function context() { return { state: treeState, nodesFor: nodes, selectedStage: stage, selectedBuild: () => build!, ascendancyName: () => build!.ascendancy, esc }; }
function mountTree() { tree = createTree($('.tree-body canvas'), context()); $('#minus').onclick = () => tree?.zoom(1 / 1.3); $('#plus').onclick = () => tree?.zoom(1.3); $('#fit').onclick = () => tree?.fit(true); $('#search').oninput = e => { view.search = treeState.search = (e.target as HTMLInputElement).value.slice(0, 200); tree?.draw(); ascendancy?.draw(); void remember().catch(report); }; $('#weapon').onchange = e => { view.weapon = treeState.weapon = (e.target as HTMLSelectElement).value as typeof view.weapon; tree?.draw(); ascendancy?.draw(); void remember().catch(report); }; const info = $<HTMLDetailsElement>('.tree-info'); info.open = view.treeInfo; info.ontoggle = () => { if (view.treeInfo !== info.open) { view.treeInfo = info.open; void remember().catch(report); } }; const pop = $('#ascendancy-view'); pop.addEventListener('toggle', e => { ascendancy?.destroy(); ascendancy = null; if ((e as ToggleEvent).newState === 'open')
    ascendancy = createTree(pop.querySelector('canvas'), context(), { ascendancy: true, compact: true }); }); }
function jump(index: number, save = true) { const sections = guideSections(build?.guideText || null, build?.stages || []); view.section = Math.max(0, Math.min(index, sections.length - 1)); const target = $('#section-' + view.section); target?.scrollIntoView({ block: 'start' }); if (save) target?.focus({ preventScroll: true }); const select = document.querySelector<HTMLSelectElement>('#guide-section'); if (select) select.value = String(view.section); document.querySelectorAll<HTMLElement>('[data-section]').forEach(b => b.setAttribute('aria-current', String(Number(b.dataset.section) === view.section))); if (save) void remember().catch(report); }
function render() {
    tree?.destroy();
    ascendancy?.destroy();
    tree = null;
    ascendancy = null;
    $('#app').innerHTML = `<header><select id="build" aria-label="${names[type]} build" title="${esc(build?.title || 'Pick a build')}"><option value="">Pick a build</option>${library.map(b => `<option value="${esc(b.id)}" ${b.id === view.build ? 'selected' : ''}>${esc(b.title)}</option>`).join('')}</select>${build && type !== 'guide' ? `<select id="variant" aria-label="Build variant" title="${esc(stage().label)}">${build.stages.map((s, i) => `<option value="${i}" ${i === view.stage ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select>` : ''}<button class="more" popovertarget="build-actions" aria-label="Build actions" title="Build actions">⋯</button><div id="build-actions" popover><button id="load">Load build file</button><button id="source" ${build?.guideUrl || build?.guideText?.url ? '' : 'disabled'}>Original guide ↗</button><button id="toggle-excerpts" ${type === 'guide' || !build ? 'hidden' : ''}>${view.notes || Object.values(view.disclosures).some(Boolean) ? 'Hide' : 'Show'} all notes</button>${build ? `<nav aria-label="Open build panel">${Object.entries(names).filter(([id]) => id !== type).map(([id, name]) => `<button data-open="${id}">${name} ↗</button>`).join('')}</nav>` : ''}</div></header><div class="content ${type === 'tree' ? 'tree-content' : ''}">${build ? (type === 'tree' ? treeMarkup() : type === 'skills' ? skillsMarkup() : type === 'gear' ? gearMarkup() : guideMarkup()) : `<div class="empty"><h1>${view.build ? 'Build unavailable' : 'PoE 2 Builds · Alpha'}</h1><p>${view.build ? 'This build was removed or is unavailable. Choose another build or load its file.' : 'Load a .tavora-build.json file to view its passive tree, skills, gear and guide in independent panels.'}</p><button id="empty-load">Load build file</button><p>URL importing will be added separately.</p></div>`}</div>`;
    const closeActions = () => $('#build-actions').hidePopover();
    $('#load').onclick = () => { closeActions(); $('#file').click(); };
    const emptyLoad = document.querySelector<HTMLButtonElement>('#empty-load'); if (emptyLoad) emptyLoad.onclick = () => $('#file').click();
    $('#source').onclick = () => { const url = build?.guideUrl || build?.guideText?.url; if (url)
        void sdk.links.open(url).catch(report); closeActions(); };
    $('#build').onchange = e => { void show((e.target as HTMLSelectElement).value || null).catch(report); };
    if (build && type !== 'guide')
        $('#variant').onchange = e => { view.stage = Number((e.target as HTMLSelectElement).value); treeState.tree = view.stage; render(); void remember().catch(report); };
    $('#toggle-excerpts').onclick = () => { view.notes = !(view.notes || Object.values(view.disclosures).some(Boolean)); view.disclosures = {}; render(); void remember().catch(report); };
    document.querySelectorAll<HTMLButtonElement>('[data-open]').forEach(button => button.onclick = () => { if (!view.build || !build)
        return; const id = view.build, section = button.dataset.guideSection; void sdk.panels.open(button.dataset.open!, { content: { id, title: build.title.slice(0, 200) } }).then(async result => { if (result === 'failed') { report('The panel could not be opened.'); return; } if (section !== undefined && !await guideLinks.navigate(id, Number(section))) report('Guide opened. Select the section in its section navigator.'); }).catch(report); closeActions(); });
    document.querySelectorAll<HTMLButtonElement>('[data-section]').forEach(button => button.onclick = () => jump(Number(button.dataset.section)));
    const sectionSelect = document.querySelector<HTMLSelectElement>('#guide-section'); if (sectionSelect) sectionSelect.onchange = () => jump(Number(sectionSelect.value));
    document.querySelectorAll<HTMLDetailsElement>('[data-note]').forEach(details => details.ontoggle = () => { if (!details.isConnected) return; const key = details.dataset.note!; if ((view.disclosures[key] ?? view.notes) !== details.open) { view.disclosures[key] = details.open; void remember().catch(report); } });
    if (build && type === 'tree')
        mountTree();
    if (build && type === 'guide') jump(view.section, false);
}
async function loadFile(file: File) { if (importing)
    throw Error('Wait for the current import to finish.'); importing = true; try {
    if (file.size > MAX_FILE_BYTES)
        throw Error('Choose a Tavora build file up to 24 MB.');
    const loaded = validate(JSON.parse(await file.text()) as unknown) as Build;
    report('Saving build…');
    const id = await repository.put(loaded);
    await refreshLibrary();
    await show(id);
    await sdk.storage.set('lastBuild', id);
    report('Build saved. All four panel types can select it.');
}
finally {
    importing = false;
} }
async function start() { sdk = await connect(); repository = new BuildRepository(sdk.documents); if (sdk.panel.type && sdk.panel.type in names)
    type = sdk.panel.type as PanelType; applyTheme(await sdk.ui.getTheme()); sdk.ui.onThemeChange(applyTheme); const launch = await sdk.panel.getLaunch(), saved = restoreView(await sdk.panel.getState()); if (launch.reason === 'restore') view = saved; guideLinks = new GuideLinks(() => ({ build: view.build, ready: type === 'guide' && build !== null }), index => jump(index)); await refreshLibrary(); const id = launch.reason === 'open' ? launch.content?.id : launch.reason === 'restore' ? saved.build ?? launch.content?.id : await sdk.storage.get<string>('lastBuild'); await show(id ?? null, launch.reason === 'restore' ? saved.stage : undefined); sdk.panel.onNavigate(async (content) => { await show(content.id); }); sdk.documents.onChange(change => { if (!change.id.startsWith('poe2-build-'))
    return; void (async () => { await refreshLibrary(); if (change.id === view.build)
    await show(view.build, view.stage);
else
    render(); })().catch(report); }); sdk.lifecycle.onDispose(() => { tree?.destroy(); ascendancy?.destroy(); guideLinks.destroy(); }); $('#file').onchange = e => { const input = e.target as HTMLInputElement, file = input.files?.[0]; if (file)
    void loadFile(file).catch(report).finally(() => { input.value = ''; }); }; }
void start().catch(e => { report(e); $('#app').innerHTML = '<div class="empty"><h1>Open this module in Tavora</h1><p>Install the module ZIP or add its development folder in Settings → Development.</p></div>'; });
