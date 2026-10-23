import { slotName, type Gem, type Item } from './model';
import { t } from './i18n';
import { itemImage } from './item-art';
import {resolveItemIdentity,weaponLabel} from './item-identity.js';
import { gemImage } from './gem-art';

import {esc} from './html';
export {esc} from './html';
import {itemDetails} from './item-details';
function attribute(g: Gem) { return g.attributes?.length === 1 ? g.attributes[0]!.toLowerCase() : 'neutral'; }
function gemLevel(g: Gem) { return g.level ? t('skill.gemLevel', { level: g.level }) : ''; }
export function gemTooltip(g: Gem): string {
    const short: Record<string,string> = {Strength:'Str',Dexterity:'Dex',Intelligence:'Int'};
    const attributes=(g.attributes||[]).map(a=>short[a]).filter(Boolean);
    return `${g.name}${attributes.length ? ` (${attributes.join('/')})` : ''}${g.level ? ' · ' + t('skill.level', { level: g.level }) : ''}`;
}
function support(g: Gem) { return `<span class="support support-${attribute(g)} ${g.lineage ? 'lineage-support' : ''}" title="${esc(gemTooltip(g))}">${gemImage(g)}${g.lineage ? '<span aria-hidden="true">✧</span>' : ''}${esc(g.name)}${g.level ? `<small class="support-level">${g.level}</small>` : ''}</span>`; }

export function skillCard(g: Gem, notes: string): string {
    const active = (g.supports || []).filter(s => s.isSupport === false);
    const supports = (g.supports || []).filter(s => s.isSupport !== false);
    return `<article class="skill"><div class="skill-icon">${gemImage(g)}</div><div class="skill-content"><div class="skill-heading"><h2 class="skill-title"><span>${esc(g.name)}</span>${g.levels?.[0] ? `<span class="required-level" title="${esc(t('skill.requiredLevel'))}">${esc(t('skill.fromLevel', { level: g.levels[0] }))}</span>` : ''}</h2><div class="skill-level">${g.level ? `<span class="gem-level" title="${esc(t('skill.actualLevel'))}">${esc(gemLevel(g))}</span>` : ''}${g.tags?.includes('Meta') ? '<span>Meta</span>' : ''}</div></div>${active.length ? `<div class="socketed-group"><span class="socketed-label">${esc(t('skill.socketed'))}</span>${active.map(s => `<span class="socketed-gem" title="${esc(gemTooltip(s))}">${gemImage(s)}${esc(s.name)}${s.level ? ' · ' + esc(t('skill.socketedLevel', { level: s.level })) : ''}</span>`).join('')}</div>` : ''}${supports.length ? `<div class="support-list">${supports.map(support).join('')}</div>` : ''}</div>${notes ? `<div class="skill-note">${notes}</div>` : ''}</article>`;
}

export function gearCard(i: Item, notes: string): string {
    i = resolveItemIdentity(i);
    const rarity = i.rarity && ['normal','magic','rare','unique'].includes(i.rarity) ? i.rarity : 'unknown';
    const level = i.level_interval?.[0] || i.level;
    const image = itemImage(i);
    const slot = /^Weapon[12]$/.test(i.inventory_id) ? weaponLabel(i) + (i.inventory_id === 'Weapon2' ? ' · ' + t('slot.set2') : '') : /^Offhand[12]$/.test(i.inventory_id) ? weaponLabel(i,true) + (i.inventory_id === 'Offhand2' ? ' · ' + t('slot.set2') : '') : i.inventory_id === 'Flask1' ? (i.slot_x ?? 0) === 0 ? 'Life flask' : i.slot_x === 1 ? 'Mana flask' : 'Flask' : i.inventory_id === 'Flask2' ? 'Mana flask' : /^Charm[1-3]$/.test(i.inventory_id) ? 'Charm ' + (i.inventory_id === 'Charm1' ? (i.slot_x ?? 0) + 1 : i.inventory_id.slice(-1)) : i.inventory_id==='Ring1'?'Ring #1':i.inventory_id==='Ring2'?'Ring #2':slotName(i.inventory_id) || i.inventory_id;
    return `<article data-rarity="${rarity}" class="gear-row ${rarity === 'unique' ? 'unique-row' : ''}"><h3 class="gear-section-label"><span>${esc(slot)}</span>${level ? `<span class="gear-level" title="${esc(t('skill.requiredLevel'))}">${esc(t('skill.fromLevel', { level }))}</span>` : ''}</h3>${itemDetails(i,notes)}</article>`;
}
