import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launch, openModule, inModule, waitForShown } from './harness';

test('shared module hints support pointer, keyboard, dynamic labels and narrow panels', async ({}, info) => {
  const id = 'tavora.playground';
  const { app, page } = await launch(undefined, [path.resolve('../../modules')]);
  const run = <T = unknown>(source: string) => inModule<T>(app, id, source);
  const input = async (event: Record<string, unknown>) => app.evaluate(({ webContents }, { id, event }) => {
    const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith('tavora-module://' + id + '/'))!;
    wc.sendInputEvent(event as any);
  }, { id, event });
  try {
    await openModule(page, id);
    await waitForShown(app, id);
    await expect.poll(() => run('!!document.querySelector("[data-tooltip-layer]")')).toBe(true);
    // Keyboard hints open on focus events, which Chromium holds back while the window isn't the one in focus on the
    // desktop (another app in front during a long run). Emulated focus keeps the page focused whatever is in front.
    await app.evaluate(async ({ webContents }, id) => {
      const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith('tavora-module://' + id + '/'))!;
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
      await wc.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
    }, id);
    await run('const filter=document.querySelector("[data-testid=filter]");filter.value="tooltips";filter.dispatchEvent(new Event("input",{bubbles:true}));');
    await expect.poll(() => run('!!document.querySelector("#tooltips")')).toBe(true);
    await run('document.querySelector("#tooltips button").id="hint-target"');
    const point = await run<{x:number;y:number}>('(()=>{const r=document.querySelector("#hint-target").getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()');
    await input({type:'mouseMove', ...point});
    await expect.poll(() => run('document.querySelector("[role=tooltip] p")?.textContent')).toBe('Readable help from the shared kit.');
    expect(await run('getComputedStyle(document.querySelector("[role=tooltip] p")).fontSize')).toBe('14px');
    expect(await run('document.querySelector("#hint-target").getAttribute("title")')).toBe('');
    expect(await run('document.querySelector("#hint-target").getAttribute("aria-describedby")')).toContain('tavora-title-tooltip');
    await run('document.querySelector("#hint-target").title="Updated help"');
    await expect.poll(() => run('document.querySelector("[role=tooltip] p")?.textContent')).toBe('Updated help');
    await run('document.querySelector("#hint-target").removeAttribute("title")');
    await expect.poll(() => run('document.querySelectorAll("[role=tooltip]").length')).toBe(0);
    await run('document.querySelector("#hint-target").title="Keyboard help"');
    await input({type:'mouseMove',x:10,y:10});
    await input({type:'keyDown',keyCode:'Tab'});
    await input({type:'keyUp',keyCode:'Tab'});
    await run('document.querySelector("#hint-target").focus()');
    await expect.poll(() => run('document.querySelector("[role=tooltip] p")?.textContent')).toBe('Keyboard help');
    await input({type:'keyDown',keyCode:'Escape'});
    await expect.poll(() => run('document.querySelectorAll("[role=tooltip]").length')).toBe(0);
    await app.evaluate(({BrowserWindow},id)=>{
      const host=BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().startsWith('data:'))!;
      const view=host.contentView.children.find(v=>(v as any).webContents?.getURL().startsWith('tavora-module://'+id+'/'))!;
      view.setBounds({...view.getBounds(),width:400});
    },id);
    await expect.poll(() => run<number>('innerWidth')).toBeLessThanOrEqual(400);
    await run('document.querySelector("#hint-target").blur();const b=document.querySelectorAll("#tooltips button")[1];b.focus();');
    await expect.poll(() => run('document.querySelector("[role=tooltip] p")?.textContent')).toContain('Readable text');
    expect(await run('getComputedStyle(document.querySelector("[role=tooltip] h2")).fontSize')).toBe('18px');
    const bounds=await run<{left:number;right:number;width:number;body:string}>('(()=>{const e=document.querySelector("[role=tooltip]"),r=e.getBoundingClientRect();return{left:r.left,right:r.right,width:innerWidth,body:getComputedStyle(e.querySelector("p")).fontSize}})()');
    expect(bounds.left).toBeGreaterThanOrEqual(12);expect(bounds.right).toBeLessThanOrEqual(bounds.width-12);expect(bounds.body).toBe('14px');
    const png=await app.evaluate(async({webContents},id)=>{const wc=webContents.getAllWebContents().find(w=>w.getURL().startsWith('tavora-module://'+id+'/'))!;return(await wc.capturePage()).toPNG().toString('base64');},id);
    await writeFile(info.outputPath('shared-tooltip-narrow.png'),Buffer.from(png,'base64'));
  } finally { await app.close(); }
});

test('the host shows its own hints and rail labels with the shared tooltip', async () => {
  const { app, page } = await launch();
  const tooltip = page.locator('[role=tooltip]');
  try {
    // A rail item: the compact card replaces the system tooltip, and fits a short label.
    await page.getByTestId('rail-settings').hover();
    await expect(tooltip.locator('h2')).toHaveText('Settings');
    await expect(page.getByTestId('rail-settings')).not.toHaveAttribute('title', /.+/);
    expect(await tooltip.evaluate(e => getComputedStyle(e.querySelector('h2')!).fontSize)).toBe('13px');
    expect((await tooltip.boundingBox())!.width).toBeLessThan(200);
    await page.mouse.move(600, 400);
    await expect(tooltip).toHaveCount(0);

    // A workspace label: the game's name as the heading, beside its icon.
    await page.getByTestId('rail-workspace-poe2').hover();
    await expect(tooltip.locator('h2')).toHaveText('Path of Exile 2');
    expect(await tooltip.evaluate(e => getComputedStyle(e.querySelector('h2')!).fontSize)).toBe('13px');
    const icon = (await page.getByTestId('rail-workspace-poe2').boundingBox())!, card = (await tooltip.boundingBox())!;
    expect(card.x).toBeGreaterThan(icon.x + icon.width - 8);
    await page.keyboard.press('Escape');
    await expect(tooltip).toHaveCount(0);
  } finally {
    await app.close();
  }
});
