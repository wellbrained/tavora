import { test,expect } from '@playwright/test';
import path from 'node:path';
import { readFile,writeFile } from 'node:fs/promises';
import { launch,inModule,waitForShown } from './harness';
const ID='wellbrained.poe2-builds',modules=path.resolve(import.meta.dirname,'../../../../modules');

test('Mobalytics guide imports through granted SDK, previews variants and survives restart',async({},info)=>{
 test.skip(!process.env.POE2_GUIDE_SMOKE_URL,'Set a public Mobalytics guide URL to run live source verification');
 test.setTimeout(120000);
 const running=await launch(undefined,[modules]);let app=running.app;
 try{
  const page=running.page;
  await page.getByTestId('add-module').click();await page.getByTestId('open-'+ID+'-guide').click();await page.getByTestId('grant-allow').click();await expect(page.getByTestId('grant-dialog')).toHaveCount(0);await page.getByTestId('add-module-dialog').getByRole('button',{name:'Close',exact:true}).click();await waitForShown(app,ID);
  const windowsBefore=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length);
  await app.evaluate(({app})=>{(globalThis as any).__importWindowShows=0;app.on('browser-window-created',(_e,win)=>win.on('show',()=>{(globalThis as any).__importWindowShows++;}));});
  await inModule(app,ID,"document.querySelector('.add-build').click();document.querySelector('#import-build').click()");
  await inModule(app,ID,`document.querySelector('#guide-url').value=${JSON.stringify(process.env.POE2_GUIDE_SMOKE_URL)};document.querySelector('#guide-read').click()`);
  await expect.poll(()=>inModule(app,ID,"({hidden:document.querySelector('#guide-preview').hidden,message:document.querySelector('#guide-error').textContent})"),{timeout:50000}).toMatchObject({hidden:false});
  expect(await inModule(app,ID,"document.querySelectorAll('#guide-variant option').length")).toBe(6);
  expect(await inModule(app,ID,"document.querySelector('#guide-variant').value")).toBe('4');
  const image=await app.evaluate(async({webContents})=>{const wc=webContents.getAllWebContents().find(w=>w.getURL().startsWith('tavora-module://wellbrained.poe2-builds/'))!;return(await wc.capturePage()).toPNG().toString('base64');});
  await writeFile(info.outputPath('guide-preview.png'),Buffer.from(image,'base64'));
  await inModule(app,ID,"document.querySelector('#guide-save').click()");
  await expect.poll(()=>inModule(app,ID,"document.querySelector('#status').textContent")).toContain('Build saved with guide text');
  const before=await inModule<{id:string;chapters:string[]}>(app,ID,"({id:document.querySelector('#build').value,chapters:[...document.querySelectorAll('.original-text')].map(n=>n.textContent)})");
  expect(before.chapters.length).toBeGreaterThan(20);expect(before.chapters.some(c=>c.includes('Barrage'))).toBe(true);
  expect(await inModule(app,ID,"[...document.querySelectorAll('.guide-tabs button')].some(n=>n.textContent==='Quest rewards')")).toBe(true);
  expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length)).toBe(windowsBefore);
  expect(await app.evaluate(()=>(globalThis as any).__importWindowShows)).toBe(0);
  await expect.poll(()=>inModule(app,ID,"document.querySelectorAll('.guide-import').length")).toBe(0);
  await inModule(app,ID,"document.querySelector('#build-actions').showPopover();document.querySelector('#refresh-guide').click()");
  expect(await inModule(app,ID,"document.querySelector('#guide-url').value")).toBe(process.env.POE2_GUIDE_SMOKE_URL);
  await inModule(app,ID,"document.querySelector('#guide-read').click()");
  await expect.poll(()=>inModule(app,ID,"document.querySelector('#guide-preview').hidden"),{timeout:50000}).toBe(false);
  expect(await inModule(app,ID,"document.querySelector('#guide-target').value")).toBe(before.id);
  await inModule(app,ID,"document.querySelector('#guide-save').click()");
  await expect.poll(()=>inModule(app,ID,"document.querySelectorAll('.guide-import').length")).toBe(0);
  expect(await inModule(app,ID,"document.querySelectorAll('#build optgroup[label=\"Guide builds\"] option').length")).toBe(1);
  await inModule(app,ID,"document.querySelector('#build-actions').showPopover();document.querySelector('#refresh-guide').click()");
  await inModule(app,ID,"document.querySelector('#guide-url').value='https://example.test/invalid';document.querySelector('#guide-url').dispatchEvent(new Event('input'));document.querySelector('#guide-read').click()");
  await expect.poll(()=>inModule(app,ID,"document.querySelector('#guide-error').textContent")).toContain('Choose a guide');
  await inModule(app,ID,"document.querySelector('.guide-import').close()");
  expect(await inModule(app,ID,"document.querySelector('#build').value")).toBe(before.id);
  await app.close();const second=await launch(running.userData,[modules]);app=second.app;await waitForShown(app,ID);
  expect(await inModule(app,ID,"[...document.querySelectorAll('.original-text')].map(n=>n.textContent)")).toEqual(before.chapters);
 }finally{await app.close();}
});

test('planner ZIP attachment previews and saves through the same build import dialog',async()=>{
 test.skip(!process.env.POE2_GUIDE_SMOKE_ZIP,'Set a local original planner ZIP');
 const {app,page}=await launch(undefined,[modules]);try{
  await page.getByTestId('add-module').click();await page.getByTestId('open-'+ID+'-gear').click();await page.getByTestId('grant-allow').click();await expect(page.getByTestId('grant-dialog')).toHaveCount(0);await page.getByTestId('add-module-dialog').getByRole('button',{name:'Close',exact:true}).click();await waitForShown(app,ID);
  await inModule(app,ID,"document.querySelector('.add-build').click();document.querySelector('#import-build').click()");
  const bytes=(await readFile(process.env.POE2_GUIDE_SMOKE_ZIP!)).toString('base64');
  await inModule(app,ID,`const dt=new DataTransfer();dt.items.add(new File([Uint8Array.from(atob(${JSON.stringify(bytes)}),c=>c.charCodeAt(0))],'planner.zip',{type:'application/zip'}));document.querySelector('#guide-attachment').files=dt.files;document.querySelector('#guide-read').click()`);
  await expect.poll(()=>inModule(app,ID,"({hidden:document.querySelector('#guide-preview').hidden,error:document.querySelector('#guide-error').textContent})")).toMatchObject({hidden:false});
  expect(await inModule(app,ID,"document.querySelectorAll('#guide-variant option').length")).toBe(6);
  expect(await inModule(app,ID,"document.querySelector('#guide-summary').textContent.includes('0 guide chapters')")).toBe(true);
  await inModule(app,ID,"document.querySelector('#guide-save').click()");
  await expect.poll(()=>inModule(app,ID,"document.querySelectorAll('.gear-list .gear-row').length")).toBeGreaterThan(10);
 }finally{await app.close();}
});
