import { test,expect } from '@playwright/test';
import path from 'node:path';
import { mkdtemp,readFile,readdir,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { launch,inModule,waitForShown } from './harness';
const ID='wellbrained.poe2-builds',modules=path.resolve(import.meta.dirname,'../../../../modules');

test('Mobalytics guide imports through granted SDK, previews variants and survives restart',async({},info)=>{
 test.skip(!process.env.POE2_GUIDE_SMOKE_URL,'Set a public Mobalytics guide URL to run live source verification');
 test.setTimeout(120000);
 const running=await launch(undefined,[modules]);let app=running.app;
 try{
  const page=running.page;
  await page.getByTestId('add-module').click();await page.getByTestId('panel-menu-toggle-'+ID).click();await page.getByTestId('open-'+ID+'-guide').click();await page.getByTestId('grant-allow').click();await expect(page.getByTestId('grant-dialog')).toHaveCount(0);await page.getByTestId('add-module-dialog').getByRole('button',{name:'Close',exact:true}).click();await waitForShown(app,ID);
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
  await expect.poll(()=>inModule(app,ID,"document.querySelector('#guide-changes').textContent")).toContain('6 unchanged');
  expect(await inModule(app,ID,"({variant:document.querySelector('#guide-variant').value,save:document.querySelector('#guide-save').textContent})")).toEqual({variant:'4',save:'Save build'});
  await inModule(app,ID,"document.querySelector('#guide-save').click()");
  await expect.poll(()=>inModule(app,ID,"document.querySelectorAll('.guide-import').length")).toBe(0);
  expect(await inModule(app,ID,"document.querySelectorAll('#build optgroup[label=\"Guide builds\"] option').length")).toBe(1);
  await inModule(app,ID,"document.querySelector('#build-actions').showPopover();document.querySelector('#refresh-guide').click()");
  await inModule(app,ID,"document.querySelector('#guide-url').value='https://example.test/invalid';document.querySelector('#guide-url').dispatchEvent(new Event('input'));document.querySelector('#guide-read').click()");
  await expect.poll(()=>inModule(app,ID,"document.querySelector('#guide-error').textContent")).toContain('Paste a guide from Mobalytics or PoE Vault');
  await inModule(app,ID,"document.querySelector('.guide-import').close()");
  expect(await inModule(app,ID,"document.querySelector('#build').value")).toBe(before.id);
  await app.close();const second=await launch(running.userData,[modules]);app=second.app;await waitForShown(app,ID);
  expect(await inModule(app,ID,"[...document.querySelectorAll('.original-text')].map(n=>n.textContent)")).toEqual(before.chapters);
 }finally{await app.close();}
});

test('PoE Vault guide imports trees and gem setups with plain requests, updates and survives restart',async({},info)=>{
 test.skip(!process.env.POE2_POEVAULT_SMOKE_URL,'Set a public PoE Vault guide URL to run live source verification');
 test.setTimeout(120000);
 const running=await launch(undefined,[modules]);let app=running.app;
 try{
  const page=running.page;
  await page.getByTestId('add-module').click();await page.getByTestId('panel-menu-toggle-'+ID).click();await page.getByTestId('open-'+ID+'-guide').click();await page.getByTestId('grant-allow').click();await expect(page.getByTestId('grant-dialog')).toHaveCount(0);await page.getByTestId('add-module-dialog').getByRole('button',{name:'Close',exact:true}).click();await waitForShown(app,ID);
  await app.evaluate(({app})=>{(globalThis as any).__importWindows=0;app.on('browser-window-created',()=>{(globalThis as any).__importWindows++;});});
  await inModule(app,ID,"document.querySelector('.add-build').click();document.querySelector('#import-build').click()");
  await inModule(app,ID,`document.querySelector('#guide-url').value=${JSON.stringify(process.env.POE2_POEVAULT_SMOKE_URL)};document.querySelector('#guide-read').click()`);
  await expect.poll(()=>inModule(app,ID,"({hidden:document.querySelector('#guide-preview').hidden,message:document.querySelector('#guide-error').textContent})"),{timeout:60000}).toMatchObject({hidden:false});
  const preview=await inModule<{variants:number;summary:string;notes:string}>(app,ID,"({variants:document.querySelectorAll('#guide-variant option').length,summary:document.querySelector('#guide-summary').textContent,notes:document.querySelector('#guide-warnings').textContent})");
  expect(preview.variants).toBeGreaterThan(0);
  expect(preview.summary).toContain('PoE Vault adapter');expect(preview.notes).toContain('no gear planner');
  const image=await app.evaluate(async({webContents})=>{const wc=webContents.getAllWebContents().find(w=>w.getURL().startsWith('tavora-module://wellbrained.poe2-builds/'))!;return(await wc.capturePage()).toPNG().toString('base64');});
  await writeFile(info.outputPath('poevault-preview.png'),Buffer.from(image,'base64'));
  // Plain requests only: no hidden page is opened.
  expect(await app.evaluate(()=>(globalThis as any).__importWindows)).toBe(0);
  await inModule(app,ID,"document.querySelector('#guide-save').click()");
  await expect.poll(()=>inModule(app,ID,"document.querySelector('#status').textContent")).toContain('Build saved with guide text');
  const before=await inModule<{id:string;chapters:string[]}>(app,ID,"({id:document.querySelector('#build').value,chapters:[...document.querySelectorAll('.original-text')].map(n=>n.textContent)})");
  expect(before.chapters.length).toBeGreaterThan(5);
  await inModule(app,ID,"document.querySelector('#build-actions').showPopover();document.querySelector('#refresh-guide').click()");
  await inModule(app,ID,"document.querySelector('#guide-read').click()");
  await expect.poll(()=>inModule(app,ID,"document.querySelector('#guide-preview').hidden"),{timeout:60000}).toBe(false);
  expect(await inModule(app,ID,"document.querySelector('#guide-target').value")).toBe(before.id);
  await expect.poll(()=>inModule(app,ID,"document.querySelector('#guide-changes').textContent")).toContain(`${preview.variants} unchanged`);
  await inModule(app,ID,"document.querySelector('.guide-import').close()");
  await app.close();const second=await launch(running.userData,[modules]);app=second.app;await waitForShown(app,ID);
  expect(await inModule(app,ID,"[...document.querySelectorAll('.original-text')].map(n=>n.textContent)")).toEqual(before.chapters);
 }finally{await app.close();}
});

test('Export build saves a guide build over 1 MiB that Load build file reads back',async()=>{
 test.skip(!process.env.POE2_EXPORT_SMOKE_FILE,'Set a saved guide build file over 1 MiB, such as an exported Mobalytics guide');
 test.setTimeout(120000);
 const file=await readFile(process.env.POE2_EXPORT_SMOKE_FILE!,'utf8');
 const exports=await mkdtemp(path.join(tmpdir(),'tavora-exports-'));
 const running=await launch(undefined,[modules],{env:{TAVORA_EXPORTS_DIR:exports}});let app=running.app;
 try{
  const page=running.page;
  await page.getByTestId('add-module').click();await page.getByTestId('panel-menu-toggle-'+ID).click();await page.getByTestId('open-'+ID+'-guide').click();await page.getByTestId('grant-allow').click();await expect(page.getByTestId('grant-dialog')).toHaveCount(0);await page.getByTestId('add-module-dialog').getByRole('button',{name:'Close',exact:true}).click();await waitForShown(app,ID);
  await inModule(app,ID,`const dt=new DataTransfer();dt.items.add(new File([${JSON.stringify(file)}],'ice-shot.tavora-build.json',{type:'application/json'}));const input=document.querySelector('#file');input.files=dt.files;input.dispatchEvent(new Event('change'))`);
  await expect.poll(()=>inModule(app,ID,"document.querySelector('#status').textContent"),{timeout:30000}).toContain('Build saved');
  const before=await inModule<string[]>(app,ID,"[...document.querySelectorAll('.original-text')].map(n=>n.textContent)");
  await inModule(app,ID,"document.querySelector('#build-actions').showPopover()");
  // The export endpoint needs a trusted native click.
  await app.evaluate(async({webContents})=>{
   const wc=webContents.getAllWebContents().find(w=>w.getURL().startsWith('tavora-module://wellbrained.poe2-builds/'))!;
   const point=await wc.executeJavaScript("(()=>{const b=document.querySelector('#export-build').getBoundingClientRect();return {x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)}})()");
   wc.sendInputEvent({type:'mouseMove',...point});wc.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});wc.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});
  });
  await expect.poll(()=>inModule(app,ID,"document.querySelector('#status').textContent"),{timeout:30000}).toContain('Saved in Downloads/Tavora: ');
  const [saved]=await readdir(exports);expect(saved).toMatch(/.tavora-build.json$/);
  const text=await readFile(path.join(exports,saved!),'utf8');expect(Buffer.byteLength(text)).toBeGreaterThan(1024*1024);
  // A fresh profile loads the exported file and shows the same guide text.
  await app.close();const second=await launch(undefined,[modules]);app=second.app;
  await second.page.getByTestId('add-module').click();await second.page.getByTestId('panel-menu-toggle-'+ID).click();await second.page.getByTestId('open-'+ID+'-guide').click();await second.page.getByTestId('grant-allow').click();await second.page.getByTestId('add-module-dialog').getByRole('button',{name:'Close',exact:true}).click();await waitForShown(app,ID);
  await inModule(app,ID,`const dt=new DataTransfer();dt.items.add(new File([${JSON.stringify(text)}],${JSON.stringify(saved)},{type:'application/json'}));const input=document.querySelector('#file');input.files=dt.files;input.dispatchEvent(new Event('change'))`);
  await expect.poll(()=>inModule(app,ID,"document.querySelector('#status').textContent"),{timeout:30000}).toContain('Build saved');
  expect(await inModule(app,ID,"[...document.querySelectorAll('.original-text')].map(n=>n.textContent)")).toEqual(before);
 }finally{await app.close();}
});

test('planner ZIP attachment previews and saves through the same build import dialog',async()=>{
 test.skip(!process.env.POE2_GUIDE_SMOKE_ZIP,'Set a local original planner ZIP');
 const {app,page}=await launch(undefined,[modules]);try{
  await page.getByTestId('add-module').click();await page.getByTestId('panel-menu-toggle-'+ID).click();await page.getByTestId('open-'+ID+'-gear').click();await page.getByTestId('grant-allow').click();await expect(page.getByTestId('grant-dialog')).toHaveCount(0);await page.getByTestId('add-module-dialog').getByRole('button',{name:'Close',exact:true}).click();await waitForShown(app,ID);
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
