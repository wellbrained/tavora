import { test, expect, type ElectronApplication } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { launch, openModule, inModule, waitForShown } from "./harness";
const ID = "local.test.tooltips";
async function fixture() {
    const parent = await mkdtemp(path.join(tmpdir(), "tavora-tooltip-test-")), root = path.join(parent, "module");
    await mkdir(path.join(root, "dist"), { recursive: true });
    await writeFile(path.join(root, "tavora.module.json"), JSON.stringify({ id: ID, name: "Tooltip test", version: "1.0.0", apiVersion: "1", entry: "dist/index.html", games: ["poe2"], viewport: { minWidth: 200, minHeight: 200 }, permissions: { network: [] } }));
    await writeFile(path.join(root, "dist/index.html"), '<!doctype html><title>Tooltip fixture</title><style>body{margin:0}button{position:absolute;top:100px;left:80px;width:60px;height:60px}</style><button id="item">Item</button><output id="result"></output><script src="main.js"></script>');
    await writeFile(path.join(root, "dist/main.js"), `
 let port,next=0,pending=new Map();window.call=(method,params)=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});port.postMessage({v:1,id,method,...(params===undefined?{}:{params})});});
 window.addEventListener('message',async e=>{if(e.data.type!=='tavora:port')return;port=e.ports[0];port.onmessage=({data:r})=>{if(r.event){if(r.event==='ui.tooltipClosed')document.querySelector('#result').textContent='closed';return;}const p=pending.get(r.id);if(p){pending.delete(r.id);r.ok?p.resolve(r.result):p.reject(r.error);}};port.start();await call('bridge.handshake',{protocol:1,sdkVersion:'0.2.8'});document.querySelector('#result').textContent='ready';});window.postMessage({type:'tavora:hello'},location.origin);
 const item=document.querySelector('#item');let id='item:1';const show=(e,pinned)=>call('ui.tooltip.show',{id,at:{x:e.clientX,y:e.clientY},content:{title:'Armageddon Edge',tone:'rare',badges:['ilvl 82','Quality: +20%'],requirements:[{label:'Level',value:'70'}],sections:[{rows:[{text:'Adds 10 to 22 Physical Damage',badges:['[P5]']}]}]},pinned}).then(r=>document.querySelector('#result').textContent=pinned?'pinned':String(r)).catch(e=>document.querySelector('#result').textContent=e.code);
 item.onpointerenter=e=>show(e,false);item.onpointermove=e=>call('ui.tooltip.move',{id,at:{x:e.clientX,y:e.clientY}});item.onpointerleave=()=>call('ui.tooltip.hide',{id});item.onclick=e=>show(e,true);
 `);
    return parent;
}
async function input(app: ElectronApplication, type: "mouseMove" | "mouseDown" | "mouseUp", x = 110, y = 130) { await app.evaluate(({ webContents }, { id, type, x, y }) => { const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith('tavora-module://' + id + '/'))!; wc.sendInputEvent({ type, x, y, ...(type === 'mouseMove' ? {} : { button: 'left' as const, clickCount: 1 }) }); }, { id: ID, type, x, y }); }
async function tooltip(app: ElectronApplication) { return app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('data:text/html')); return w ? { visible: w.isVisible(), bounds: w.getBounds() } : null; }); }
test('hover crosses panel bounds without freezing; pin survives unrelated input, Escape closes', async () => {
    const { app, page } = await launch(undefined, [await fixture()]);
    try {
        await openModule(page, ID);
        await waitForShown(app, ID);
        await expect.poll(() => inModule(app, ID, "document.querySelector('#result').textContent")).toBe('ready');
        // Narrow the native panel independently of the window to exercise the actual clipping boundary.
        await app.evaluate(({ BrowserWindow }) => { const host = BrowserWindow.getAllWindows().find(w => !w.webContents.getURL().startsWith('data:text/html'))!; const view = host.contentView.children.find(v => (v as any).webContents?.getURL().startsWith('tavora-module://local.test.tooltips/'))!; const b = view.getBounds(); view.setBounds({ ...b, width: 300 }); });
        await input(app, 'mouseMove', 110, 130);
        await expect.poll(async () => (await tooltip(app))?.visible).toBe(true);
        const state = await app.evaluate(({ BrowserWindow }) => { const host = BrowserWindow.getAllWindows().find(w => !w.webContents.getURL().startsWith('data:text/html'))!, float = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('data:text/html'))!; const view = host.contentView.children.find(v => (v as any).webContents?.getURL().startsWith('tavora-module://local.test.tooltips/'))!; return { area: host.getContentBounds(), panel: view.getBounds(), visible: (view as any).getVisible(), tooltip: float.getBounds() }; });
        expect(state.visible).toBe(true);
        expect(state.tooltip.x + state.tooltip.width).toBeGreaterThan(state.area.x + state.panel.x + state.panel.width);
        expect(state.tooltip.x + state.tooltip.width).toBeLessThanOrEqual(state.area.x + state.area.width);
        await input(app, 'mouseDown');
        await input(app, 'mouseUp');
        await expect.poll(() => inModule(app, ID, "document.querySelector('#result').textContent")).toBe('pinned');
        await input(app, 'mouseMove', 250, 300);
        await input(app, 'mouseDown',250,300);await input(app, 'mouseUp',250,300);
        expect((await tooltip(app))?.visible).toBe(true);
        await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(w => !w.webContents.getURL().startsWith('data:text/html'))!; w.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); });
        await expect.poll(async () => (await tooltip(app))?.visible).toBe(false);
        await input(app, 'mouseMove', 250, 300);
        await input(app, 'mouseMove', 110, 130);
        await expect.poll(async () => (await tooltip(app))?.visible).toBe(true);
        await app.evaluate(({ webContents }) => { webContents.getAllWebContents().find(w => w.getURL().startsWith('tavora-module://local.test.tooltips/'))!.reload(); });
        await expect.poll(async () => (await tooltip(app))?.visible).toBe(false);
    }
    finally {
        await app.close();
    }
});

test('PoE2 Gear imports a portable build and sends artwork and stats to the shared surface',async({ },testInfo)=>{
 test.skip(!process.env.POE2_SMOKE_FILE,'Set POE2_SMOKE_FILE to an exported build');
 const id='wellbrained.poe2-builds',modules=path.resolve(import.meta.dirname,'../../../../modules');
 const {app,page}=await launch(undefined,[modules]);try{
  await page.getByTestId('add-module').click();await page.getByTestId('open-'+id+'-gear').click();await page.keyboard.press('Escape');await waitForShown(app,id);
  const file=await readFile(process.env.POE2_SMOKE_FILE!,'utf8');
  await inModule(app,id,`(()=>{const input=document.querySelector('#file'),dt=new DataTransfer();dt.items.add(new File([${JSON.stringify(file)}],'fixture.tavora-build.json',{type:'application/json'}));input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await expect.poll(()=>inModule<number>(app,id,"document.querySelectorAll('.equip-slot').length")).toBe(15);
  const at=await inModule<{x:number;y:number}>(app,id,"(()=>{const r=document.querySelector('[data-slot=weapon]').getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()");
  await app.evaluate(({webContents},{id,at})=>{const wc=webContents.getAllWebContents().find(w=>w.getURL().startsWith('tavora-module://'+id+'/'))!;wc.sendInputEvent({type:'mouseMove',...at});},{id,at});
  await expect.poll(async()=> (await tooltip(app))?.visible).toBe(true);
  const rendered=await app.evaluate(async({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('data:text/html'))!;return w.webContents.executeJavaScript('({text:document.body.innerText,image:document.querySelector("img")?.src,html:document.querySelector("#card").innerHTML,bullet:getComputedStyle(document.querySelector("li .text"),"::before").content})');});
  expect(rendered.bullet).toBe('"'+String.fromCharCode(8226)+'"');expect(rendered.text).toContain('Armageddon Edge');expect(rendered.text).toContain('[P5]');expect(rendered.image).toMatch(/^data:image\//);expect(rendered.html).not.toContain('tavora-module://');
  const png=await app.evaluate(async({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('data:text/html'))!;return(await w.webContents.capturePage()).toPNG().toString('base64');});
  await writeFile(testInfo.outputPath('gear-tooltip.png'),Buffer.from(png,'base64'));
  // Changing the source clears both the host surface and the module's local pin state.
  await app.evaluate(({webContents},{id,at})=>{const wc=webContents.getAllWebContents().find(w=>w.getURL().startsWith('tavora-module://'+id+'/'))!;wc.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...at});wc.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...at});},{id,at});
  await expect.poll(()=>inModule(app,id,"!!document.querySelector('.equip-slot.pinned')")).toBe(true);
  await inModule(app,id,"document.querySelector('#build').value='';document.querySelector('#build').dispatchEvent(new Event('change'))");
  await expect.poll(async()=> (await tooltip(app))?.visible).toBe(false);
 }finally{await app.close();}
});

test('a pinned tooltip closes on app focus loss or a hidden source',async()=>{
 const {app,page}=await launch(undefined,[await fixture()]);try{
  await openModule(page,ID);await waitForShown(app,ID);
  await expect.poll(()=>inModule(app,ID,"document.querySelector('#result').textContent")).toBe('ready');
  await input(app,'mouseMove');await input(app,'mouseDown');await input(app,'mouseUp');
  await expect.poll(()=>inModule(app,ID,"document.querySelector('#result').textContent")).toBe('pinned');
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().startsWith('data:text/html'))!;w.blur();w.emit('blur');});
  await expect.poll(async()=> (await tooltip(app))?.visible).toBe(false);
  await expect.poll(()=>inModule(app,ID,"document.querySelector('#result').textContent")).toBe('closed');
  await input(app,'mouseMove',250,300);await input(app,'mouseMove');await input(app,'mouseDown');await input(app,'mouseUp');
  await expect.poll(()=>inModule(app,ID,"document.querySelector('#result').textContent")).toBe('pinned');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().startsWith('data:text/html'))!.hide());
  await expect.poll(async()=> (await tooltip(app))?.visible).toBe(false);
 }finally{await app.close();}
});
