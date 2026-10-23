import { afterEach, expect, it } from 'vitest';
import { setLanguage, noteText, plural } from './i18n';
import { de, en } from './locales';
import { addMenuActions, panelMenuActions } from './panel-menus';
import { skillCard, gearCard, gemTooltip } from './presentation';
import { guideReaderMarkup, guideGroups } from './guide-reader';
import { readerChapters } from './guide-chapters';
import { guideAddress } from './guide-sources';
import { weaponSlotState } from './item-identity.js';
import { restoreView } from './view-state';
import { validate } from './validate.js';
import type { Build, Gem } from './model';

afterEach(() => setLanguage('en'));

const gem: Gem = {id:'ice',name:'Ice Shot',attributes:['Dexterity'],isSupport:false,level:20,levels:[31,100],supports:[{id:'support',name:'Martial Tempo',attributes:['Strength'],isSupport:true,level:2}]};
function build(): Build {
 return validate({format:'tavora.build',formatVersion:1,buildId:'german-test',build:{title:'Ice Shot Deadeye',source:'Mobalytics',version:'0.5',treeVersion:'0.5',ascendancy:'Deadeye',guideUrl:'https://mobalytics.gg/poe-2/builds/ice-shot-deadeye',
  importNotes:['Planner recommendations may omit rarity, exact item rolls and gem levels. Missing values remain empty.','Attribute picks on 1 passive nodes are saved but not shown yet.','A note Tavora does not know.'],
  character:{name:'Frosty',class:'Ranger',level:92,source:'poe.ninja',importedAt:'2026-10-23T08:00:00.000Z',url:'https://poe.ninja/poe2/builds/rise/character/acc/Frosty',account:'acc',league:'Rise'},
  stages:[{label:'Endgame',passives:[],skills:[gem],items:[{inventory_id:'Weapon1',name:'Death Whisper',base:'Recurve Bow',category:'Bow',rarity:'rare',mods:['+20% increased Projectile Speed']}]}]},
  guideText:{sections:[{title:'Leveling · Endgame',text:'Use Ice Shot until level 12.',context:'overview'}]}});
}

it('keeps the English and German catalogs in step', () => {
 expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
 for (const [key, text] of Object.entries(en)) expect(new Set(de[key as keyof typeof de].match(/\{\w+\}/g)), key).toEqual(new Set(text.match(/\{\w+\}/g)));
});

it('shows the menus in German', () => {
 setLanguage('de');
 expect(addMenuActions()).toContain('Build importieren');
 expect(addMenuActions()).toContain('Charakter importieren');
 const menu = panelMenuActions(build(), 'tree', false);
 expect(menu).toContain('Charakter exportieren');
 expect(menu).toContain('Alle Notizen einblenden');
 expect(menu).toContain('Ausrüstung öffnen');
});

it('uses plural forms where a count appears', () => {
 setLanguage('de');
 expect(plural('character.setups', 1)).toBe('1 wählbares Setup');
 expect(plural('character.setups', 3)).toBe('3 wählbare Setups');
 setLanguage('en');
 expect(plural('character.items', 1)).toBe('1 equipped item');
 expect(plural('character.items', 12)).toBe('12 equipped items');
});

it('keeps game names English in German mode', () => {
 setLanguage('de');
 const skill = skillCard(gem, '');
 expect(skill).toContain('Ice Shot');
 expect(skill).toContain('Martial Tempo');
 expect(skill).toContain('Gem-Stufe 20');
 expect(skill).toContain('Ab Stufe 31');
 expect(gemTooltip(gem)).toBe('Ice Shot (Dex) · Stufe 20');
 const gear = gearCard(build().stages[0]!.items[0]!, '');
 expect(gear).toContain('Death Whisper');
 expect(gear).toContain('Bow · Haupthand');
 expect(gear).toContain('+20% increased Projectile Speed');
 expect(weaponSlotState([{inventory_id:'Weapon1',name:'Big Staff',category:'Staff',mods:[]}],1)).toMatchObject({mainLabel:'Staff · Haupthand',offhandLabel:'Braucht beide Hände'});
});

it('keeps guide text as the author wrote it and translates only the reader around it', () => {
 setLanguage('de');
 const b = build(), markup = guideReaderMarkup(b, restoreView(null));
 expect(markup).toContain('Use Ice Shot until level 12.');
 expect(markup).toContain('Alle zuklappen');
 expect(guideGroups(b).map(g => g.label)).toContain('Endgame');
 const information = readerChapters(b).find(c => c.key === 'build-information')!;
 expect(information.title).toBe('Build-Infos');
 expect(information.text).toContain('Ranger · Stufe 92');
 expect(information.text).toContain('Planer-Empfehlungen können Seltenheit');
 expect(information.text).toContain('Attributwahl auf 1 passivem Knoten');
 expect(information.text).toContain('A note Tavora does not know.');
});

it('reads saved English import notes in the language shown', () => {
 expect(noteText('Attribute picks on 1 passive nodes are saved but not shown yet.')).toBe('Attribute picks on 1 passive node are saved but not shown yet.');
 setLanguage('de');
 expect(noteText('Mobalytics adapter 3 · patch 0.5')).toBe('Mobalytics-Adapter 3 · Patch 0.5');
 expect(noteText('2 passive trees use an older planner link and were left out.')).toBe('2 Passivbäume nutzen einen älteren Planer-Link und wurden weggelassen.');
 expect(noteText('Not displayed: equipment slot Weapon 3.')).toBe('Nicht angezeigt: Ausrüstungsplatz Weapon 3.');
});

it('reports errors in German', () => {
 setLanguage('de');
 expect(() => guideAddress('not a url')).toThrow('Füg die URL eines Guides von Mobalytics oder PoE Vault ein.');
 setLanguage('en');
 expect(() => guideAddress('https://example.org/guide')).toThrow('Paste a guide from Mobalytics or PoE Vault.');
});
