import {equipmentOrder} from './item-details';
import {buildDisplayTitle} from './item-data.js';
import {visibilitySwitch,collapseIcon} from './controls';
import { connect, type TavoraSDK, type TavoraTheme } from '@tavora/sdk';
import { validate } from './validate.js';
import { guideSections, guideSectionIndex, guideNote, MAX_FILE_BYTES, type Build, type Stage } from './model';
import { restoreView } from './view-state';
import { Inventory, inventoryMarkup } from './inventory';
import { GuideLinks } from './guide-links';
import { readerChapters } from './guide-chapters';
import { guideReaderMarkup, guideGroups } from './guide-reader';
import { allocationCounts } from './tree-counts';
import { BuildRepository } from './repository';
import { createTree } from './tree.js';
import trees from './trees.json';
import { esc, skillCard, gearCard } from './presentation';
import './style.css';
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const names = { tree: 'Tree', skills: 'Skills', gear: 'Gear', guide: 'Guide' } as const;
type PanelType = keyof typeof names;
let sdk: TavoraSDK, repository: BuildRepository, type: PanelType = 'tree', view = restoreView(null), build: Build | null = null;
let guideLinks: GuideLinks;
let inventory: Inventory | null = null;
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
async function refreshLibrary() { library = (await repository.list()).map(d => ({ id: d.id, title: buildDisplayTitle(d.title) })).sort((a, b) => a.title.localeCompare(b.title)); }
async function show(id: string | null, index?: number) { const current = ++request, loaded = id ? await repository.get(id) : null; if (current !== request)
    return; const same = view.build === id; build = loaded; view.build = id; view.stage = Math.max(0, Math.min(index ?? loaded?.defaultStage ?? 0, (loaded?.stages.length ?? 1) - 1)); if (!same) { view.section = 0; view.disclosures = {}; view.guideChapters = {}; } treeState.tree = view.stage; treeState.weapon = view.weapon; treeState.search = view.search; await remember(); render(); }
function noteOpen(key: string) { return view.disclosures[key] ?? (key === 'gear-footer' ? true : view.notes); }
function anyNotesOpen() { return view.notes || Object.values(view.disclosures).some(Boolean) || (type === 'gear' && build && !!guideNote(build.guideText,view.stage,'gear') && noteOpen('gear-footer')); }
function excerpt(text: string | undefined, key: string = type) { const section = guideSectionIndex(guideSections(build!.guideText, build!.stages), type, text, (key === type || key === 'gear-footer') ? stage().label : undefined); return text ? `<details class="excerpt" data-note="${esc(key)}" ${noteOpen(key) ? 'open' : ''}><summary>Notes</summary><p>${esc(text)}</p><button data-open="guide" data-guide-section="${section}">Read in Guide ↗</button></details>` : ''; }
function skillsMarkup() { return excerpt(guideNote(build!.guideText, view.stage, 'skills')) + stage().skills.map(g => skillCard(g, excerpt(build!.guideText?.gems?.[g.id], 'gem:' + g.id))).join(''); }
function gearMarkup() {
    const notes=excerpt(guideNote(build!.guideText,view.stage,'gear'),'gear-footer');
    return `<div class="gear-scroll" tabindex="0" aria-label="Equipment inventory and list">${inventoryMarkup(view.inventory,view.equipmentList)}<div id="equipment-list" class="gear-list" ${view.equipmentList?'':'hidden'}>${stage().items.length ? [...stage().items].sort((a,b)=>equipmentOrder(a)-equipmentOrder(b)).map(i=>gearCard(i,excerpt(build!.guideText?.items?.[i.inventory_id],'item:'+i.inventory_id))).join(''):'<p>No equipment data in this variant.</p>'}</div></div>${notes?`<footer class="gear-notes">${notes}</footer>`:''}`;
}
function nodes() { return (trees as Record<string, unknown[]>)[build?.treeVersion || '0.5'] || []; }
function treeMarkup() { const counts = allocationCounts(stage().passives); return excerpt(guideNote(build!.guideText, view.stage, 'tree')) + `<div class="tree-body main-tree"><canvas tabindex="0" aria-label="Passive tree: drag to pan, scroll to zoom"></canvas><div class="tree-tools">${visibilitySwitch('ascendancy-toggle',esc(build!.ascendancy || 'Ascendancy'),false,'ascendancy-view')}<input id="search" class="tree-search" placeholder="Find a passive…" aria-label="Search passives" maxlength="200" value="${esc(treeState.search)}"></div><div class="node-tooltip" hidden></div><div class="tree-bottom"><details class="tree-info"><summary><span class="info-mark" aria-hidden="true">i</span>Tree info<span class="control-chevron" aria-hidden="true"></span></summary><dl class="tree-status"><div><dt>Total</dt><dd>${counts.total}</dd></div><div><dt>Set 1</dt><dd>${counts.set1}</dd></div><div><dt>Set 2</dt><dd>${counts.set2}</dd></div></dl></details><div class="tree-buttons"><button id="minus" aria-label="Zoom out">−</button><button id="fit">Fit build</button><button id="plus" aria-label="Zoom in">+</button><button id="fit-all" title="Show the whole passive tree">All</button></div></div></div><div class="weapon-allocation"><span>Weapon allocation</span><div class="segmented" role="group" aria-label="Weapon allocation">${[['all','Both'],['1','Set 1'],['2','Set 2']].map(([value,label]) => `<button data-weapon="${value}" aria-pressed="${treeState.weapon === value}" class="${treeState.weapon === value ? 'active' : ''}">${label}</button>`).join('')}</div><div class="tree-display-options"><label title="Show decorative frames around passive nodes in both tree views. Allocation colours stay unchanged."><input id="decorative-frames" type="checkbox" ${view.decorativeFrames ? 'checked' : ''}> Decorative frames</label><label title="Show allocated notable and keystone names when zoomed in"><input id="node-names" type="checkbox" ${view.nodeNames ? 'checked' : ''}> Node names</label></div></div><div id="ascendancy-view" popover role="dialog" aria-labelledby="ascendancy-heading"><div class="ascendancy-header"><div><strong id="ascendancy-heading">${esc(build!.ascendancy || 'Ascendancy')}</strong><small>${esc(stage().label)}</small></div><button aria-label="Close ascendancy" popovertarget="ascendancy-view" popovertargetaction="hide">×</button></div><div class="tree-body"><canvas tabindex="0" aria-label="Ascendancy tree"></canvas><div class="node-tooltip" hidden></div></div><footer>Hover a node for its effect. Press Escape to return to the main tree.</footer></div>`; }
function context() { return { state: treeState, nodesFor: nodes, selectedStage: stage, selectedBuild: () => build!, ascendancyName: () => build!.ascendancy, decorativeFrames: () => view.decorativeFrames, nodeNames: () => view.nodeNames, esc }; }
function mountTree() {
    tree = createTree($('.main-tree canvas'), context());
    $('#minus').onclick = () => tree?.zoom(1 / 1.3);
    $('#plus').onclick = () => tree?.zoom(1.3);
    $('#fit').onclick = () => tree?.fit(true);
    $('#fit-all').onclick = () => tree?.fit(false);
    $('#search').oninput = e => { view.search = treeState.search = (e.target as HTMLInputElement).value.slice(0, 200); tree?.draw(); ascendancy?.draw(); void remember().catch(report); };
    document.querySelectorAll<HTMLButtonElement>('[data-weapon]').forEach(button => button.onclick = () => {
        view.weapon = treeState.weapon = button.dataset.weapon as typeof view.weapon;
        document.querySelectorAll<HTMLButtonElement>('[data-weapon]').forEach(b => { const active = b === button; b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active)); });
        tree?.draw(); ascendancy?.draw(); void remember().catch(report);
    });
    $<HTMLInputElement>('#decorative-frames').onchange = e => { view.decorativeFrames = (e.target as HTMLInputElement).checked; tree?.draw(); ascendancy?.draw(); void remember().catch(report); };
    $<HTMLInputElement>('#node-names').onchange = e => { view.nodeNames = (e.target as HTMLInputElement).checked; tree?.draw(); ascendancy?.draw(); void remember().catch(report); };
    const info = $<HTMLDetailsElement>('.tree-info'); info.open = view.treeInfo;
    info.ontoggle = () => { if (info.isConnected && view.treeInfo !== info.open) { view.treeInfo = info.open; void remember().catch(report); } };
    const pop = $('#ascendancy-view');
    $<HTMLInputElement>('#ascendancy-toggle').onchange=e=>(e.target as HTMLInputElement).checked?pop.showPopover():pop.hidePopover();
    pop.addEventListener('toggle', e => { $<HTMLInputElement>('#ascendancy-toggle').checked=(e as ToggleEvent).newState==='open'; ascendancy?.destroy(); ascendancy = null; if ((e as ToggleEvent).newState === 'open') ascendancy = createTree(pop.querySelector('canvas'), context(), { ascendancy: true, compact: true }); });
}
function jump(index: number, save = true) {
    const chapters = build ? readerChapters(build) : [];
    view.section = Math.max(0, Math.min(Number.isSafeInteger(index) ? index : 0, chapters.length - 1));
    const groups = build ? guideGroups(build, chapters) : [], group = groups.find(g=>g.chapters.some(c=>c.index===view.section));
    document.querySelectorAll<HTMLDetailsElement>('[data-chapter]').forEach((d,i)=>d.hidden=i!==view.section);
    document.querySelectorAll<HTMLButtonElement>('[data-tab-group]').forEach(button=>{
        button.hidden=button.dataset.tabGroup!==group?.key;
        const selected=Number(button.dataset.section)===view.section;
        button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;
    });
    document.querySelectorAll<HTMLButtonElement>('[data-guide-group]').forEach(button=>button.setAttribute('aria-current',String(button.dataset.guideGroup===group?.key)));
    const groupSelect=document.querySelector<HTMLSelectElement>('#guide-group');if(groupSelect&&group)groupSelect.value=group.key;
    const target = document.querySelector<HTMLDetailsElement>('#section-' + view.section);
    if (target && save) { target.open = true; view.guideChapters[target.dataset.chapter!] = true; }
    target?.scrollIntoView({ block: 'start' });
    if (save) target?.querySelector('summary')?.focus({ preventScroll: true });
    const select = document.querySelector<HTMLSelectElement>('#guide-section'); if (select) select.value = String(view.section);
    document.querySelectorAll<HTMLElement>('[data-section]').forEach(b => b.setAttribute('aria-current', String(Number(b.dataset.section) === view.section)));
    syncGuideAll();
    if (save) void remember().catch(report);
}
function syncGuideAll() {
    const control = document.querySelector<HTMLButtonElement>('#guide-toggle-all');
    if (control) control.innerHTML = `${collapseIcon(!Array.from(document.querySelectorAll<HTMLDetailsElement>('[data-chapter]')).some(d=>d.open))}${Array.from(document.querySelectorAll<HTMLDetailsElement>('[data-chapter]')).some(d => d.open) ? 'Collapse' : 'Expand'} all`;
}
function mountGuide() {
    $('#guide-nav-toggle').onchange = () => {
        view.guideSidebar = !view.guideSidebar;
        $('.guide-reader').classList.toggle('nav-collapsed', !view.guideSidebar);
        const button = $<HTMLInputElement>('#guide-nav-toggle'); button.checked=view.guideSidebar;
         void remember().catch(report);
    };
    const groups = guideGroups(build!);
    const selectGroup = (key: string) => { const group=groups.find(g=>g.key===key); if(group)jump(group.chapters[0]!.index); };
    $('#guide-group').onchange = e => selectGroup((e.target as HTMLSelectElement).value);
    document.querySelectorAll<HTMLButtonElement>('[data-guide-group]').forEach(button=>button.onclick=()=>selectGroup(button.dataset.guideGroup!));
    document.querySelectorAll<HTMLButtonElement>('[role=tab]').forEach(button=>button.onkeydown=e=>{
        if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
        e.preventDefault();const tabs=Array.from(document.querySelectorAll<HTMLButtonElement>('[role=tab]')).filter(t=>!t.hidden),i=tabs.indexOf(button);
        const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
        const target=tabs[next];if(target){jump(Number(target.dataset.section));target.focus();}
    });
    const chapters = Array.from(document.querySelectorAll<HTMLDetailsElement>('[data-chapter]'));
    for (const chapter of chapters) chapter.ontoggle = () => {
        if (!chapter.isConnected) return;
        const key = chapter.dataset.chapter!;
        if ((view.guideChapters[key] ?? view.guideExpanded) !== chapter.open) {
            view.guideChapters[key] = chapter.open; syncGuideAll(); void remember().catch(report);
        }
    };
    $('#guide-toggle-all').onclick = () => {
        view.guideExpanded = !chapters.some(d => d.open); view.guideChapters = {};
        for (const chapter of chapters) chapter.open = view.guideExpanded;
        syncGuideAll(); void remember().catch(report);
    };
    document.querySelectorAll<HTMLElement>('[data-reference]').forEach(button => button.onclick = event => {
        event.preventDefault();
        void sdk.links.open(button.dataset.reference!).catch(report);
    });
    jump(view.section, false);
}
function render() {
    inventory?.destroy(); inventory = null;
    tree?.destroy();
    ascendancy?.destroy();
    tree = null;
    ascendancy = null;
    $('#app').innerHTML = `<header><select id="build" aria-label="${names[type]} build" title="${esc(build?.title || 'Pick a build')}"><option value="">Pick a build</option>${library.map(b => `<option value="${esc(b.id)}" ${b.id === view.build ? 'selected' : ''}>${esc(b.title)}</option>`).join('')}</select>${build && type !== 'guide' ? `<select id="variant" aria-label="Build variant" title="${esc(stage().label)}">${build.stages.map((s, i) => `<option value="${i}" ${i === view.stage ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select>` : ''}<button class="more" popovertarget="build-actions" aria-label="Build actions" title="Build actions">⋯</button><div id="build-actions" popover><button id="load">Load build file</button><button id="source" ${build?.guideUrl || build?.guideText?.url ? '' : 'disabled'}>Original guide ↗</button><button id="toggle-excerpts" ${type === 'guide' || !build ? 'hidden' : ''}>${anyNotesOpen() ? 'Hide' : 'Show'} all notes</button>${build ? `<nav aria-label="Open build panel">${Object.entries(names).filter(([id]) => id !== type).map(([id, name]) => `<button data-open="${id}">${name} ↗</button>`).join('')}</nav>` : ''}</div></header><div class="content ${type === 'tree' ? 'tree-content' : type === 'gear' ? 'gear-content' : type === 'guide' ? 'guide-content' : ''}">${build ? (type === 'tree' ? treeMarkup() : type === 'skills' ? skillsMarkup() : type === 'gear' ? gearMarkup() : guideReaderMarkup(build, view)) : `<div class="empty"><h1>${view.build ? 'Build unavailable' : 'PoE 2 Builds · Alpha'}</h1><p>${view.build ? 'This build was removed or is unavailable. Choose another build or load its file.' : 'Load a .tavora-build.json file to view its passive tree, skills, gear and guide in independent panels.'}</p><button id="empty-load">Load build file</button><p>URL importing will be added separately.</p></div>`}</div>`;
    const closeActions = () => $('#build-actions').hidePopover();
    $('#load').onclick = () => { closeActions(); $('#file').click(); };
    const emptyLoad = document.querySelector<HTMLButtonElement>('#empty-load'); if (emptyLoad) emptyLoad.onclick = () => $('#file').click();
    $('#source').onclick = () => { const url = build?.guideUrl || build?.guideText?.url; if (url)
        void sdk.links.open(url).catch(report); closeActions(); };
    $('#build').onchange = e => { void show((e.target as HTMLSelectElement).value || null).catch(report); };
    if (build && type !== 'guide')
        $('#variant').onchange = e => { view.stage = Number((e.target as HTMLSelectElement).value); treeState.tree = view.stage; render(); void remember().catch(report); };
    $('#toggle-excerpts').onclick = () => { view.notes = !anyNotesOpen(); view.disclosures = type === 'gear' ? { 'gear-footer': view.notes } : {}; render(); void remember().catch(report); };
    document.querySelectorAll<HTMLButtonElement>('[data-open]').forEach(button => button.onclick = () => { if (!view.build || !build)
        return; const id = view.build, section = button.dataset.guideSection; void sdk.panels.open(button.dataset.open!, { content: { id, title: build.title.slice(0, 200) } }).then(async result => { if (result === 'failed') { report('The panel could not be opened.'); return; } if (section !== undefined && !await guideLinks.navigate(id, Number(section))) report('Guide opened. Select the section in its section navigator.'); }).catch(report); closeActions(); });
    document.querySelectorAll<HTMLButtonElement>('[data-section]').forEach(button => button.onclick = () => jump(Number(button.dataset.section)));
    const sectionSelect = document.querySelector<HTMLSelectElement>('#guide-section'); if (sectionSelect) sectionSelect.onchange = () => jump(Number(sectionSelect.value));
    document.querySelectorAll<HTMLDetailsElement>('[data-note]').forEach(details => details.ontoggle = () => { if (!details.isConnected) return; const key = details.dataset.note!; if (noteOpen(key) !== details.open) { view.disclosures[key] = details.open; void remember().catch(report); } });
    if (build && type === 'tree')
        mountTree();
    if (build && type === 'gear') inventory = new Inventory($('.gear-content'), stage().items, {shown:view.inventory, listShown:view.equipmentList, notesFor:item => build!.guideText?.items?.[item.inventory_id], weapon:view.gearWeapon, onChange:change => { Object.assign(view,change); void remember().catch(report); }});
    if (build && type === 'guide') mountGuide();
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
    render(); })().catch(report); }); sdk.lifecycle.onDispose(() => { tree?.destroy(); ascendancy?.destroy(); guideLinks.destroy(); inventory?.destroy(); }); $('#file').onchange = e => { const input = e.target as HTMLInputElement, file = input.files?.[0]; if (file)
    void loadFile(file).catch(report).finally(() => { input.value = ''; }); }; }
void start().catch(e => { report(e); $('#app').innerHTML = '<div class="empty"><h1>Open this module in Tavora</h1><p>Install the module ZIP or add its development folder in Settings → Development.</p></div>'; });
