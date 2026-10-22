import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  launch,
  newUserData,
  seedLibrary,
  inModule,
  waitForShown,
} from "./harness";
const ID = "wellbrained.enshrouded";
const moduleDir = path.resolve("..", "..", "modules", "enshrouded");
const officialDirs=["notes","todos","whiteboard","discord","playground","ai-usage"].map(name=>path.join(path.dirname(moduleDir),name)).join(path.delimiter);
test("Enshrouded 1.0 builds allocate, export, import and survive restart in the real host", async ({}, info) => {
  const userData = await newUserData();
  const seed = seedLibrary();
  const enshrouded = {
    ...seed.games.poe2,
    id: "enshrouded",
    catalogId: "enshrouded",
    name: "Enshrouded",
    icon: { kind: "monogram", text: "E" },
  };
  await writeFile(
    path.join(userData, "library.json"),
    JSON.stringify({
      ...seed,
      games: { enshrouded },
      root: [{ kind: "game", id: "enshrouded" }],
      lastGameId: "enshrouded",
    }),
  );
  const exports = path.join(userData, "Exports");
  const options = { seed: false, env: { TAVORA_EXPORTS_DIR: exports, TAVORA_OFFICIAL_MODULE_DIRS:officialDirs } };
  let running = await launch(userData, [path.dirname(moduleDir)], options);
  let app = running.app;
  const capture = async (name: string) => {
    await inModule(app, ID, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const png = await app.evaluate(async ({webContents}) => {
      const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith('tavora-module://wellbrained.enshrouded/'))!;
      return (await wc.capturePage()).toPNG().toString('base64');
    });
    await writeFile(info.outputPath(name), Buffer.from(png, 'base64'));
  };
  try {
    await running.page.getByTestId("add-module").click();
    await running.page.getByTestId("open-" + ID).click();
    if (await running.page.getByTestId("add-module-dialog").count())
      await running.page
        .getByTestId("add-module-dialog")
        .getByRole("button", { name: "Close", exact: true })
        .click();
    await expect
      .poll(() =>
        inModule(
          app,
          ID,
          'document.querySelectorAll("[data-node]").length',
        ).catch(() => 0),
      )
      .toBe(231);
    await waitForShown(app, ID);
    expect(await inModule(app, ID, 'getComputedStyle(document.body).fontFamily')).toMatch(/Inter|Segoe|sans-serif/);
    const geometry = await inModule<{ overlaps: string[]; labelOverlaps: string[] }>(app, ID, `(() => {
      const nodes = [...document.querySelectorAll('[data-node]')].map(node => {
        const point = node.transform.baseVal.getItem(0).matrix;
        return { id: node.dataset.node, x: point.e, y: point.f, r: Number(node.querySelector('circle').getAttribute('r')) };
      });
      const labels = [...document.querySelectorAll('.class-label')].map(label => ({name: label.textContent, box: label.getBBox()}));
      const labelOverlaps = labels.flatMap(label => nodes.filter(node => {
        const b = label.box;
        return Math.hypot(node.x - Math.max(b.x, Math.min(node.x,b.x+b.width)), node.y - Math.max(b.y, Math.min(node.y,b.y+b.height))) < node.r + 12;
      }).map(node => label.name + ':' + node.id));
      return { labelOverlaps, overlaps: nodes.flatMap((a, i) => nodes.slice(i + 1).filter(b => Math.hypot(a.x-b.x,a.y-b.y) < a.r+b.r).map(b => a.id + ':' + b.id)) };
    })()`);
    expect.soft(geometry.overlaps, 'skill hit areas must not overlap').toEqual([]);
    expect.soft(geometry.labelOverlaps, 'class names must clear skill nodes').toEqual([]);
    await inModule(app, ID, 'document.querySelector("#new").click()');
    const controls = await inModule<{width:number;expectedWidth:number;save:string;primary:string;buttonHeight:number;selectAppearance:string}>(app, ID, `(() => {
      const dialog = document.querySelector('#dialog');
      const save = document.querySelector('#dialog-yes');
      const swatch = document.createElement('span');
      swatch.style.backgroundColor = 'var(--primary)'; document.body.append(swatch);
      const primary = getComputedStyle(swatch).backgroundColor; swatch.remove();
      return { width: dialog.getBoundingClientRect().width, expectedWidth: Math.min(420, innerWidth-32), save: getComputedStyle(save).backgroundColor, primary, buttonHeight: document.querySelector('#new').getBoundingClientRect().height, selectAppearance: getComputedStyle(document.querySelector('#build')).appearance };
    })()`);
    expect.soft(controls.width).toBeCloseTo(controls.expectedWidth, 0);
    expect.soft(controls.save).toBe(controls.primary);
    expect.soft(controls.buttonHeight).toBe(32);
    expect.soft(controls.selectAppearance).toBe('none');
    await capture('enshrouded-dialog.png');
    await inModule(
      app,
      ID,
      'document.querySelector("#name").value="My wizard";document.querySelector("#dialog-form").requestSubmit()',
    );
    await expect
      .poll(() =>
        inModule(app, ID, 'document.querySelector("#status").textContent'),
      )
      .toBe("Saved");
    await inModule(
      app,
      ID,
      'document.querySelectorAll("[data-node]")[1].dispatchEvent(new FocusEvent("focusin",{bubbles:true}));document.querySelectorAll("[data-node]")[1].dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}))',
    );
    await expect
      .poll(() =>
        inModule(
          app,
          ID,
          'document.querySelectorAll("[data-node]")[1].getAttribute("aria-pressed")',
        ),
      )
      .toBe("true");
    expect(await inModule(app, ID, 'document.querySelector("#bonuses-sidebar").hidden')).toBe(false);
    expect(await inModule(app, ID, '[...document.querySelectorAll("[data-bonus-node]")].map(n=>n.dataset.bonusNode)')).toEqual(["2"]);
    expect(await inModule(app, ID, 'document.querySelector(".bonus-rank").textContent')).toMatch(/Rank 1\//);
    expect(await inModule(app, ID, 'document.querySelector("#bonus-no-attributes").hidden')).toBe(false);
    expect(await inModule(app, ID, 'Math.abs(document.querySelector("#bonuses").getBoundingClientRect().right-(document.querySelector(".toolbar").getBoundingClientRect().right-12))')).toBeLessThan(1);
    await capture('enshrouded-bonuses.png');
    await inModule(app, ID, 'document.querySelectorAll("[data-node]")[1].dispatchEvent(new PointerEvent("pointermove",{clientX:innerWidth-12,clientY:innerHeight-12,bubbles:true}))');
    expect(await inModule(app, ID, '({hidden:document.querySelector("#skill-tooltip").hidden,node:document.querySelector("#skill-tooltip").dataset.tooltipNode,title:document.querySelector("#skill-card-title").textContent,strong:document.querySelectorAll(".skill-card-body strong").length})')).toMatchObject({hidden:false,node:"2",title:"Power Parry",strong:expect.any(Number)});
    const tooltipBounds = await inModule<{left:number;top:number;right:number;bottom:number;width:number;height:number}>(app, ID, '(()=>{const b=document.querySelector("#skill-tooltip").getBoundingClientRect();return{left:b.left,top:b.top,right:b.right,bottom:b.bottom,width:innerWidth,height:innerHeight}})()');
    expect(tooltipBounds.left).toBeGreaterThanOrEqual(8);
    expect(tooltipBounds.top).toBeGreaterThanOrEqual(8);
    expect(tooltipBounds.right).toBeLessThanOrEqual(tooltipBounds.width-8);
    expect(tooltipBounds.bottom).toBeLessThanOrEqual(tooltipBounds.height-8);
    expect(await inModule(app, ID, 'getComputedStyle(document.querySelector(".skill-card-body p")).fontWeight')).toBe("400");
    expect(await inModule(app, ID, 'getComputedStyle(document.querySelector(".skill-card-body p")).fontFamily')).toMatch(/Inter/);
    expect(await inModule(app, ID, 'getComputedStyle(document.querySelector("#skill-card-title")).fontFamily')).toMatch(/Inter/);
    expect(await inModule(app, ID, 'document.querySelectorAll("#tree title").length')).toBe(0);
    await capture('enshrouded-skill-tooltip.png');
    await inModule(app, ID, 'document.querySelectorAll("[data-node]")[1].dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
    expect(await inModule(app, ID, 'document.querySelector("#skill-tooltip").hidden')).toBe(true);
    await inModule(app, ID, 'document.querySelectorAll("[data-node]")[1].focus()');
    expect(await inModule(app, ID, 'document.querySelector("#skill-tooltip").hidden')).toBe(false);
    expect(await inModule(app, ID, 'document.querySelectorAll("[data-node]")[1].getAttribute("aria-describedby")')).toBe("skill-tooltip");
    await inModule(app, ID, 'document.querySelector("#tree").dispatchEvent(new PointerEvent("pointerleave"))');
    await expect.poll(() => inModule(app, ID, 'document.querySelector("#skill-tooltip").hidden')).toBe(true);
    const saved = await inModule<string>(
      app,
      ID,
      'document.querySelector("#build").value',
    );
    await expect
      .poll(() =>
        inModule(app, ID, 'document.querySelector("#export").disabled'),
      )
      .toBe(false);
    await waitForShown(app, ID);
    expect(await inModule(app,ID,'fetch("/_exports/json/",{method:"POST",body:"{}"}).then(r=>r.status)')).toBe(403);
    await inModule(
      app,
      ID,
      'window.trace=[];for(const type of ["pointerdown","click"])window.addEventListener(type,e=>trace.push({type,target:e.target.id,trusted:e.isTrusted}),true)',
    );
    // Trusted native input is required by the JSON export endpoint.
    await app.evaluate(async ({ webContents }) => {
      const wc = webContents
        .getAllWebContents()
        .find((w) =>
          w.getURL().startsWith("tavora-module://wellbrained.enshrouded/"),
        )!;
      const point = await wc.executeJavaScript(
        '(()=>{const b=document.querySelector("#export").getBoundingClientRect();return {x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)}})()',
      );
      wc.sendInputEvent({ type: "mouseMove", ...point });
      wc.sendInputEvent({
        type: "mouseDown",
        button: "left",
        clickCount: 1,
        ...point,
      });
      wc.sendInputEvent({
        type: "mouseUp",
        button: "left",
        clickCount: 1,
        ...point,
      });
    });
    await expect
      .poll(() =>
        inModule(
          app,
          ID,
          '({status:document.querySelector("#status").textContent,trace:window.trace})',
        ),
      )
      .toMatchObject({
        status: expect.stringContaining("Saved in Downloads/Tavora:"),
      });
    await expect.poll(() => readdir(exports).catch(() => [])).toHaveLength(1);
    const files = await readdir(exports),
      json = await readFile(path.join(exports, files[0]!), "utf8");
    expect(JSON.parse(json).skills).toContain("2");
    await inModule(
      app,
      ID,
      "const dt=new DataTransfer();dt.items.add(new File([" +
        JSON.stringify(json) +
        '],"build.json",{type:"application/json"}));document.querySelector("#file").files=dt.files;document.querySelector("#file").dispatchEvent(new Event("change"))',
    );
    await expect
      .poll(() => inModule(app, ID, 'document.querySelector("#dialog").open'))
      .toBe(true);
    await inModule(
      app,
      ID,
      'document.querySelector("#name").value="Imported wizard";document.querySelector("#dialog-form").requestSubmit()',
    );
    await expect
      .poll(() =>
        inModule(app, ID, 'document.querySelectorAll("#build option").length'),
      )
      .toBe(3);
    await expect
      .poll(() =>
        inModule(
          app,
          ID,
          'document.querySelector("#build").selectedOptions[0].textContent',
        ),
      )
      .toBe("Imported wizard");
    await inModule(app, ID, 'document.querySelector("#tree").setAttribute("viewBox","-250 -280 800 800")');
    await capture('enshrouded-zoomed.png');
    await inModule(app, ID, 'document.querySelector("#fit").click()');
    const state = await inModule(
      app,
      ID,
      '({overflow:document.documentElement.scrollWidth>innerWidth,nodes:document.querySelectorAll("[data-node]").length,broken:[...document.querySelectorAll("image")].map(n=>n.getAttribute("href"))})',
    );
    expect(state).toMatchObject({ overflow: false, nodes: 231 });
    const image = await app.evaluate(async ({ webContents }) => {
      const wc = webContents
        .getAllWebContents()
        .find((w) =>
          w.getURL().startsWith("tavora-module://wellbrained.enshrouded/"),
        )!;
      return (await wc.capturePage()).toPNG().toString("base64");
    });
    await writeFile(
      info.outputPath("enshrouded-wide.png"),
      Buffer.from(image, "base64"),
    );
    await app.evaluate(({BrowserWindow,webContents})=>{const wc=webContents.getAllWebContents().find(w=>w.getURL().startsWith('tavora-module://wellbrained.enshrouded/'))!;const view=BrowserWindow.getAllWindows()[0]!.contentView.children.find(v=>(v as any).webContents?.id===wc.id)!;view.setBounds({x:80,y:80,width:400,height:600});});
    await expect.poll(()=>inModule(app,ID,'innerWidth')).toBe(400);
    expect(await inModule(app,ID,'({overflow:document.documentElement.scrollWidth>innerWidth,treeHeight:document.querySelector("#tree").getBoundingClientRect().height})')).toMatchObject({overflow:false,treeHeight:expect.any(Number)});
    const narrow=await app.evaluate(async({webContents})=>{const wc=webContents.getAllWebContents().find(w=>w.getURL().startsWith('tavora-module://wellbrained.enshrouded/'))!;return(await wc.capturePage()).toPNG().toString('base64');});await writeFile(info.outputPath('enshrouded-narrow.png'),Buffer.from(narrow,'base64'));
    await inModule(app, ID, 'document.querySelector("#new").click()');
    expect(await inModule(app, ID, 'document.querySelector("#dialog").getBoundingClientRect().width')).toBe(368);
    await capture('enshrouded-dialog-narrow.png');
    await inModule(app, ID, 'document.querySelector("#dialog-cancel").click()');
    expect(await inModule(app, ID, 'document.querySelector(".bonus-body").scrollWidth>document.querySelector(".bonus-body").clientWidth')).toBe(false);
    await capture('enshrouded-bonuses-narrow.png');
    await inModule(app, ID, 'document.querySelectorAll("[data-node]")[1].dispatchEvent(new PointerEvent("pointermove",{clientX:390,clientY:590,bubbles:true}))');
    expect(await inModule(app, ID, '(()=>{const b=document.querySelector("#skill-tooltip").getBoundingClientRect();return b.left>=8&&b.right<=innerWidth-8&&b.top>=8&&b.bottom<=innerHeight-8})()')).toBe(true);
    await capture('enshrouded-skill-tooltip-narrow.png');
    await inModule(app, ID, 'document.querySelector("#bonuses").click()');
    expect(await inModule(app, ID, 'document.querySelector("#bonuses-sidebar").hidden')).toBe(true);
    await app.close();
    running = await launch(userData, [path.dirname(moduleDir)], options);
    app = running.app;
    await expect
      .poll(() =>
        inModule(
          app,
          ID,
          'document.querySelector("#build")?.selectedOptions[0]?.textContent',
        ).catch(() => null),
      )
      .toBe("Imported wizard");
    expect(await inModule(app, ID, 'document.querySelector("#bonuses-sidebar").hidden')).toBe(true);
    await inModule(app, ID, 'document.querySelector("#bonuses").click()');
    expect(
      await inModule(
        app,
        ID,
        'document.querySelectorAll("[data-node]")[1].getAttribute("aria-pressed")',
      ),
    ).toBe("true");
    await inModule(app, ID, 'document.querySelector("#reset").click()');
    await inModule(
      app,
      ID,
      'document.querySelector("#dialog-form").requestSubmit()',
    );
    await expect
      .poll(() =>
        inModule(
          app,
          ID,
          'document.querySelectorAll("[data-node][aria-pressed=true]").length',
        ),
      )
      .toBe(0);
    await inModule(
      app,
      ID,
      'document.querySelector("#build").value=' +
        JSON.stringify(saved) +
        ';document.querySelector("#build").dispatchEvent(new Event("change"))',
    );
    await expect
      .poll(() =>
        inModule(
          app,
          ID,
          'document.querySelectorAll("[data-node]")[1].getAttribute("aria-pressed")',
        ),
      )
      .toBe("true");
  } finally {
    await app.close();
  }
});

test('the signed Enshrouded alpha installs with publisher ownership',async()=>{test.skip(!process.env.ENSHROUDED_SIGNED_ZIP,'Set ENSHROUDED_SIGNED_ZIP to verify a release package');const userData=await newUserData();const seed=seedLibrary();const game={...seed.games.poe2,id:'enshrouded',catalogId:'enshrouded',name:'Enshrouded'};await writeFile(path.join(userData,'library.json'),JSON.stringify({...seed,games:{enshrouded:game},root:[{kind:'game',id:'enshrouded'}],lastGameId:'enshrouded'}));const {app,page}=await launch(userData,[],{seed:false});try{await page.getByTestId('rail-settings').click();await page.getByTestId('settings-nav-modules').click();await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=(async()=>({canceled:false,filePaths:[file]})) as any;},process.env.ENSHROUDED_SIGNED_ZIP!);await page.getByTestId('install-module').click();await expect(page.getByTestId('module-'+ID)).toBeVisible();await expect(page.getByTestId('module-publisher-'+ID)).toBeVisible();await page.getByTestId('settings-close').click();await page.getByTestId('add-module').click();await page.getByTestId('open-'+ID).click();if(await page.getByTestId('add-module-dialog').count())await page.getByTestId('add-module-dialog').getByRole('button',{name:'Close',exact:true}).click();await waitForShown(app,ID);expect(await inModule(app,ID,'document.querySelectorAll("[data-node]").length')).toBe(231);await inModule(app,ID,'document.querySelector("#new").click()');await inModule(app,ID,'document.querySelector("#name").value="Signed build";document.querySelector("#dialog-form").requestSubmit()');await expect.poll(()=>inModule(app,ID,'document.querySelector("#status").textContent')).toBe('Saved');const owners=await readdir(path.join(userData,'module-data'));expect(owners).toContain('2b85409d347617c9b8fe014fae1d90ec');}finally{await app.close();}});
