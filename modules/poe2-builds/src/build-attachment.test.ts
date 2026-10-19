import { readFile } from 'node:fs/promises';
import { expect,it } from 'vitest';
import { plannerZip,readBuildAttachment } from './build-attachment';
const planner={name:'Early',ascendancy:'Ranger1',author:'',inventory_slots:[{inventory_id:'Weapon1',additional_text:'Obliterator Bow\n1. Adds 10 to 22 Physical Damage',level_interval:[78,100]}],skills:[{id:'Metadata/Items/Gem/SkillGemIceShot',level_interval:[31,100],support_skills:[{id:'Metadata/Items/Gems/SupportGemPrimalArmamentTwo'}]}],passives:[]};
it('reads planner attachments with honest rarity and character requirements',async()=>{
 const b=await readBuildAttachment(new File([JSON.stringify(planner)],'example.build'));
 expect(b.stages[0]?.items[0]).toMatchObject({name:'Obliterator Bow',rarity:'unknown',level_interval:[78,100]});
 expect(b.stages[0]?.skills[0]).toMatchObject({name:'Ice Shot',levels:[31,100]});
 expect(b.stages[0]?.skills[0]?.supports?.[0]).toMatchObject({name:'Elemental Armament II',isSupport:true});
 expect(b.guideText).toBe(null);
});
it('refuses unsupported data, damaged archives and unavailable identities',async()=>{
 await expect(plannerZip(new Uint8Array(30))).rejects.toThrow();
 await expect(readBuildAttachment(new File([JSON.stringify({...planner,skills:[{id:'unknown'}]})],'broken.build'))).rejects.toThrow('not bundled');
 await expect(readBuildAttachment(new File([JSON.stringify({...planner,passives:[{id:'nonexistent-node'}]})],'broken.build'))).rejects.toThrow('not in the bundled tree');
});
it.skipIf(!process.env.POE2_GUIDE_SMOKE_ZIP)('reads all original planner ZIP variants without extracting files',async()=>{
 const file=new File([await readFile(process.env.POE2_GUIDE_SMOKE_ZIP!)],'guide.zip');
 const b=await readBuildAttachment(file);
 expect(b.stages).toHaveLength(6);expect(b.stages.every(s=>s.items.length>10&&s.passives.length>100)).toBe(true);
 const bytes=new Uint8Array(await file.arrayBuffer());
 // A damaged central-directory checksum cannot silently change build data.
 const view=new DataView(bytes.buffer);let at=0;for(;at<bytes.length-46;at++)if(view.getUint32(at,true)===0x02014b50)break;
 view.setUint32(at+16,0,true);await expect(plannerZip(bytes)).rejects.toThrow('integrity');
});
