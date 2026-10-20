import { test, expect, type ElectronApplication } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launch, inModule, waitForShown } from './harness';

const ID='wellbrained.poe2-builds',modules=path.resolve(import.meta.dirname,'../../../../modules');
const xml=`<PathOfBuilding2><Build className="Ranger" ascendClassName="Deadeye" level="80"/><Items activeItemSet="1"><Item id="1">Rarity: RARE
Test Bow
Obliterator Bow
Item Level: 80
Quality: 20
LevelReq: 78
Implicits: 0
Adds 10 to 22 Physical Damage
</Item><ItemSet id="1"><Slot name="Weapon 1" itemId="1"/></ItemSet></Items><Skills activeSkillSet="1"><SkillSet id="1"><Skill><Gem nameSpec="Ice Shot" gemId="Metadata/Items/Gems/SkillGemIceShot" level="18" quality="20"/></Skill></SkillSet></Skills><Tree activeSpec="1"><Spec nodes="97" treeVersion="0_5"/></Tree></PathOfBuilding2>`;
async function openImport(app:ElectronApplication){
 await expect.poll(()=>inModule(app,ID,"document.querySelectorAll('.character-import').length")).toBe(0);
 await inModule(app,ID,"document.querySelector('.add-build').click();document.querySelector('#import-character').click()");
 await expect.poll(()=>inModule(app,ID,"!!document.querySelector('.character-import[open]')")).toBe(true);
}
async function readPob(app:ElectronApplication,value=xml){
 await inModule(app,ID,`document.querySelector('#character-source').value='code';document.querySelector('#character-source').dispatchEvent(new Event('change'));document.querySelector('#character-input').value=${JSON.stringify(value)};document.querySelector('#character-read').click()`);
 await expect.poll(()=>inModule(app,ID,"document.querySelector('#character-preview').hidden")).toBe(false);
}
test('PoB preview, new character, safe update, independent library group and restart',async({},info)=>{
 const running=await launch(undefined,[modules]);let app=running.app;
 try{
  await running.page.getByTestId('add-module').click();await running.page.getByTestId('open-'+ID+'-gear').click();
  await running.page.getByTestId('grant-allow').click();await expect(running.page.getByTestId('grant-dialog')).toHaveCount(0);await running.page.getByTestId('add-module-dialog').getByRole('button',{name:'Close',exact:true}).click();await waitForShown(app,ID);
  await app.evaluate(({BrowserWindow})=>{const host=BrowserWindow.getAllWindows()[0]!;const view=host.contentView.children.find(v=>(v as any).webContents?.getURL().startsWith('tavora-module://wellbrained.poe2-builds/'))!;view.setBounds({...view.getBounds(),width:400,height:608});});
  expect(await inModule(app,ID,"document.querySelector('.add-build').getBoundingClientRect().right<=innerWidth")).toBe(true);
  expect(await inModule(app,ID,"document.querySelector('#app>header').firstElementChild.classList.contains('add-build')")).toBe(true);
  expect(await inModule(app,ID,"Array.from(document.querySelectorAll('#add-actions .menu-label')).map(n=>n.textContent)")).toEqual(['Import build','Import character','Load build file']);
  expect(await inModule(app,ID,"document.querySelector('#import-build').disabled")).toBe(false);
  await openImport(app);await readPob(app);
  const image=await app.evaluate(async({webContents})=>{const wc=webContents.getAllWebContents().find(w=>w.getURL().startsWith('tavora-module://wellbrained.poe2-builds/'))!;return(await wc.capturePage()).toPNG().toString('base64');});
  await writeFile(info.outputPath('character-preview.png'),Buffer.from(image,'base64'));
  await inModule(app,ID,"document.querySelector('#character-name').value='Test character';document.querySelector('#character-save').click()");
  await expect.poll(()=>inModule(app,ID,"document.querySelector('#status').textContent")).toContain('Character saved');
  await expect.poll(()=>inModule(app,ID,"document.querySelector('#build optgroup').label")).toBe('My characters');
  const id=await inModule<string>(app,ID,"document.querySelector('#build').value");
  expect(await inModule<string>(app,ID,"document.querySelector('.gear-list').textContent")).toContain('Test Bow');
  const menuRows=await inModule<{labels:string[];vertical:boolean}>(app,ID,"(()=>{document.querySelector('#build-actions').showPopover();const rows=[...document.querySelectorAll('#build-actions nav button')],boxes=rows.map(e=>e.getBoundingClientRect());const result={labels:rows.map(e=>e.querySelector('.menu-label').textContent),vertical:boxes.every((b,i)=>!i||b.top>=boxes[i-1].bottom)};document.querySelector('#build-actions').hidePopover();return result;})()");
  expect(menuRows.labels).toEqual(['Open Tree','Open Skills','Open Guide']);expect(menuRows.vertical).toBe(true);
  await openImport(app);await readPob(app,xml.replace('Test Bow','Updated Bow'));
  await inModule(app,ID,`document.querySelector('#character-target').value=${JSON.stringify(id)};document.querySelector('#character-name').value='Test character';document.querySelector('#character-save').click()`);
  await expect.poll(()=>inModule(app,ID,"document.querySelector('.gear-list').textContent")).toContain('Updated Bow');
  expect(await inModule(app,ID,"document.querySelectorAll('#build optgroup[label=\"My characters\"] option').length")).toBe(1);
  await openImport(app);await readPob(app);
  await inModule(app,ID,"document.querySelector('#character-input').value='invalid';document.querySelector('#character-input').dispatchEvent(new Event('input'));document.querySelector('#character-read').click()");
  await expect.poll(()=>inModule(app,ID,"document.querySelector('#character-error').textContent")).toContain('decompressed');
  await inModule(app,ID,"document.querySelector('.character-import').close()");
  expect(await inModule<string>(app,ID,"document.querySelector('.gear-list').textContent")).toContain('Updated Bow');
  await app.close();
  const second=await launch(running.userData,[modules]);app=second.app;await waitForShown(app,ID);
  await expect.poll(()=>inModule(app,ID,"document.querySelector('.gear-list')?.textContent||''")).toContain('Updated Bow');
  expect(await inModule(app,ID,"document.querySelector('#build').value")).toBe(id);
 }finally{await app.close();}
});

test('real poe.ninja import uses granted SDK network and saves its exact snapshot',async()=>{
 test.skip(!process.env.POE2_CHARACTER_SMOKE_URL,'Set a public character URL to run live source verification');
 const {app,page}=await launch(undefined,[modules]);try{
  await page.getByTestId('add-module').click();await page.getByTestId('open-'+ID+'-gear').click();await page.getByTestId('grant-allow').click();await expect(page.getByTestId('grant-dialog')).toHaveCount(0);await page.getByTestId('add-module-dialog').getByRole('button',{name:'Close',exact:true}).click();await waitForShown(app,ID);
  await openImport(app);
  await inModule(app,ID,`document.querySelector('#character-input').value=${JSON.stringify(process.env.POE2_CHARACTER_SMOKE_URL)};document.querySelector('#character-read').click()`);
  await expect.poll(()=>inModule(app,ID,"({preview:document.querySelector('#character-preview').hidden,error:document.querySelector('#character-error').textContent})"),{timeout:35000}).toMatchObject({preview:false});
  await inModule(app,ID,"document.querySelector('#character-save').click()");
  await expect.poll(()=>inModule(app,ID,"document.querySelector('#status').textContent")).toContain('Character saved');
  expect(await inModule(app,ID,"document.querySelectorAll('.gear-list .gear-row').length")).toBeGreaterThan(10);
  expect(await inModule(app,ID,"document.querySelector('#source').textContent")).toContain('View character');
  await expect.poll(()=>inModule(app,ID,"document.querySelectorAll('.character-import').length")).toBe(0);
  await inModule(app,ID,"document.querySelector('#build-actions').showPopover();document.querySelector('#refresh-character').click()");
  await expect.poll(()=>inModule(app,ID,"document.querySelector('#character-preview').hidden"),{timeout:35000}).toBe(false);
  expect(await inModule(app,ID,"document.querySelector('#character-target').value")).not.toBe('');
 }finally{await app.close();}
});

test('local real PoB XML supports browser file selection',async()=>{
 test.skip(!process.env.POE2_CHARACTER_SMOKE_XML,'Set a local PoB XML file');
 const {app,page}=await launch(undefined,[modules]);try{
  await page.getByTestId('add-module').click();await page.getByTestId('open-'+ID+'-skills').click();await page.getByTestId('grant-allow').click();await expect(page.getByTestId('grant-dialog')).toHaveCount(0);await page.getByTestId('add-module-dialog').getByRole('button',{name:'Close',exact:true}).click();await waitForShown(app,ID);await openImport(app);
  const file=await readFile(process.env.POE2_CHARACTER_SMOKE_XML!,'utf8');
  await inModule(app,ID,`document.querySelector('#character-source').value='xml';document.querySelector('#character-source').dispatchEvent(new Event('change'));const dt=new DataTransfer();dt.items.add(new File([${JSON.stringify(file)}],'character.xml',{type:'text/xml'}));document.querySelector('#character-file').files=dt.files;document.querySelector('#character-read').click()`);
  await expect.poll(()=>inModule(app,ID,"document.querySelector('#character-preview').hidden")).toBe(false);
  await inModule(app,ID,"document.querySelector('#character-save').click()");
  await expect.poll(()=>inModule(app,ID,"document.querySelector('.skill-level')?.textContent||''")).toContain('20');
  expect(await inModule(app,ID,"document.querySelectorAll('.skill').length")).toBeGreaterThan(3);
 }finally{await app.close();}
});
