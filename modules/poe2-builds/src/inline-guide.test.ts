import { expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { guideNote, portable } from './model';
import { validate } from './validate.js';
import { itemImage, placeholderImage } from './item-art';
import { readerChapters } from './guide-chapters';
import manifest from '../tavora.module.json';

function build() {
    return validate({format:'tavora.build',formatVersion:1,buildId:'inline-test',build:{title:'Test',stages:[{label:'Early',skills:[],items:[],passives:[]},{label:'Late',skills:[],items:[],passives:[]}]},guideText:{skills:'Legacy common note',stageNotes:{'0':{skills:'Early named skill.'},'1':{}},sections:[{title:'Skills · Early',text:'Priority: Skill A -> Skill B',context:'skills'}]}});
}

it('persists per-variant notes and never borrows an early note for a blank late variant',()=>{
    const loaded=validate(JSON.parse(JSON.stringify(portable(build()))));
    expect(guideNote(loaded.guideText,0,'skills')).toBe('Early named skill.');
    expect(guideNote(loaded.guideText,1,'skills')).toBeUndefined();
    expect(guideNote({skills:'Legacy'},0,'skills')).toBe('Legacy');
    expect(guideNote(null,0,'skills')).toBeUndefined();
});

it('uses custom placeholders including separate flask positions, but keeps real art first',()=>{
    expect(placeholderImage('Weapon1')).toBe('assets/icons/gear-weapon.svg');
    expect(placeholderImage('Helm1')).toBe('assets/icons/gear-helmet.png');
    expect(placeholderImage('Ring2')).toBe('assets/icons/gear-ring.png');
    expect(placeholderImage('Flask1',0)).toBe('assets/icons/gear-health-flask.png');
    expect(placeholderImage('Flask1',1)).toBe('assets/icons/gear-mana-flask.png');
    expect(placeholderImage('Flask2')).toBe('assets/icons/gear-mana-flask.png');
    expect(itemImage({inventory_id:'Weapon1',name:'Warmonger Bow',mods:[]}).actual).toBe(true);
});

it('provides four distinct bundled panel icons and valid transparent PNG exports',()=>{
    const paths=manifest.panels.map(p=>p.icon);expect(new Set(paths).size).toBe(4);
    for(const path of [...paths,manifest.icon]){
        const local=fileURLToPath(new URL('../public/'+path.replace(/^dist\//,''),import.meta.url));
        expect(existsSync(local)).toBe(true);
        const bytes=readFileSync(local);expect(bytes.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');
        expect(bytes.readUInt32BE(16)).toBe(64);expect(bytes.readUInt32BE(20)).toBe(64);expect(bytes[25]).toBe(6);
    }
});

it('renders source-verified priorities and rotation from the repaired local fixture',()=>{
    const path=process.env['POE2_REPAIRED_FILE'];if(!path)return;
    const restored=validate(JSON.parse(JSON.stringify(portable(validate(JSON.parse(readFileSync(path,'utf8')))))));
    const sections=readerChapters(restored);
    const early=sections.find(s=>s.title==='Skill Gems · Early')!.text;
    expect(early).toContain('6 Link Priority: Snipe -> Ice Shot -> Herald of Ice -> Freezing Mark');
    expect(early).toContain('Quality Priority: Freezing Mark -> Herald of Ice -> Snipe -> Ice Shot');
    expect(early).toContain('Pre-place Tornado Shot, cast Ice-Tipped Arrows, spam Ice Shot');
    const endgame=sections.find(s=>s.title==='Skill Gems · Uber Endgame')!.text;
    expect(endgame).toContain('Pre-place Tornado Shot, spam Ice Shot');
    expect(endgame).not.toContain('cast Ice-Tipped Arrows');
    expect(guideNote(restored.guideText,5,'skills')).toBeUndefined();
});
