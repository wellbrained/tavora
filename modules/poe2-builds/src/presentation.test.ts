import { expect, it } from 'vitest';
import { skillCard, gearCard, gemTooltip } from './presentation';
import { validate } from './validate.js';
import { portable, type Gem, type Item } from './model';
const gem: Gem = {id:'ice',name:'Ice Shot',attributes:['Dexterity'],isSupport:false,levels:[31,100],supports:[{id:'support',name:'Support II',attributes:['Strength'],isSupport:true,lineage:true}]};

it('keeps character ranges separate from actual gem levels across save/load', () => {
 const input = {format:'tavora.build',formatVersion:1,buildId:'level-test',build:{title:'Levels',stages:[{skills:[{...gem,level:20,supports:[{...gem.supports![0],level:2}]}],items:[],passives:[]}]}};
 const saved=validate(JSON.parse(JSON.stringify(portable(validate(input)))));
 const skill=saved.stages[0]!.skills[0]!;
 expect(skill.level).toBe(20);expect(skill.levels).toEqual([31,100]);expect(skill.supports![0]!.level).toBe(2);
 const markup=skillCard(skill,'');expect(markup).toContain('Gem level 20');expect(markup).toContain('From level 31');
 expect(skillCard(gem,'')).not.toContain('Gem level not exported');expect(skillCard(gem,'')).not.toContain('Gem level 31');
});
it('retains coloured gem markers, support badges and distinct socketed active skills',()=>{
 const markup=skillCard({...gem,supports:[...gem.supports!,{...gem,id:'socketed',name:'Socketed skill',supports:[]}]},'<details>Notes</details>');
 expect(markup).toContain('gem-mark gem-dexterity');expect(markup).toContain('support-strength lineage-support');expect(markup).toContain('socketed-group');expect(markup).toContain('<details>Notes</details>');
});
it('shows gear icons and a source rarity badge without inventing missing rarity',()=>{
 const item:Item={inventory_id:'Weapon1',name:'<Unique bow>',rarity:'unique',mods:['<modifier>']};
 const markup=gearCard(item,'');expect(markup).toContain('assets/icons/gear-weapon.svg');expect(markup).toContain('rarity-badge rarity-unique');expect(markup).toContain('>Unique</span>');expect(markup).not.toContain('<Unique bow>');expect(markup).toContain('&lt;modifier&gt;');
 expect(gearCard({...item,rarity:'unknown'},'')).not.toContain('Rarity not provided');
 expect(gearCard({...item,rarity:'unknown'},'')).not.toContain('rarity-badge');
});

it('uses precise gem titles and puts the character level beside the skill name',()=>{
 expect(gemTooltip({...gem,name:'Maim'})).toBe('Maim (Dex)');
 expect(gemTooltip({...gem,name:'Maim',level:2})).toBe('Maim (Dex) · Level 2');
 expect(gemTooltip({...gem,name:'Unknown',attributes:[]})).toBe('Unknown');
 const markup=skillCard(gem,'');
 expect(markup.indexOf('required-level')).toBeLessThan(markup.indexOf('</h2>'));
 expect(markup).not.toContain('not exported');expect(markup).not.toContain('Attribute not available');
});

it('keeps the active icon separate from skill content and uses slot headings with modifier lists',()=>{
 const skill=skillCard(gem,'');
 expect(skill).toContain('class="skill-icon"');expect(skill).toContain('class="skill-content"');
 expect(skill.indexOf('skill-icon')).toBeLessThan(skill.indexOf('skill-content'));
 const gear=gearCard({inventory_id:'Weapon1',name:'Bow',level:78,mods:['Damage','Attack speed']},'');
 expect(gear).toContain('class="gear-section-label"');expect(gear).toContain('From level 78');
 expect(gear).toContain('<ul class="mods stat-list">');expect(gear.indexOf('>Damage<')).toBeLessThan(gear.indexOf('>Attack speed<'));
 expect(gear.indexOf('gear-level')).toBeLessThan(gear.indexOf('gear-item-body'));
});
