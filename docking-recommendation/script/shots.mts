// Throwaway tooling (not committed): drives the real app through the docking preview and saves pictures and a video.
// Run: node scripts/dock-shots/shots.mts <scene> <dark|light>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { launch, openModule, shootWindow, setContentSize, NOTES, TODOS, VANILLA, REACT, VUE, RAIL_WIDTH } from "../../test/e2e/harness.ts";

const OUT = "/Users/doki/Projects/Tavora/_mockups/docking-recommendation";
mkdirSync(OUT, { recursive: true });
const scene = process.argv[2]!;
const theme = (process.argv[3] ?? "dark") as "dark" | "light";

const group = (page: Page, moduleId: string) => page.locator(".dv-groupview", { has: page.locator(`[data-module-id="${moduleId}"]`) }).first();
const tab = (page: Page, moduleId: string) => page.locator(`[data-panel-tab][data-module-id="${moduleId}"]`).first();
const trace: { t: number; x: number; y: number }[] = [];
const mv = (page: Page, x: number, y: number) => {
  trace.push({ t: Date.now() / 1000, x, y });
  return page.mouse.move(x, y);
};
const sleep = (page: Page, ms: number) => page.waitForTimeout(ms);
let pace = 16;

async function setup(opts: { extraTab?: boolean; size?: [number, number] } = {}) {
  const run = await launch(undefined, [], { systemTheme: theme });
  const { page, app } = run;
  if (opts.size) await setContentSize(app, opts.size[0], opts.size[1]);
  await page.getByTestId("layouts").click();
  await page.locator('[role="menu"][data-state="open"] [data-testid="layout-grid-2x2"]').click();
  for (const m of [NOTES, TODOS, REACT, VUE]) await openModule(page, m);
  if (opts.extraTab) {
    await tab(page, NOTES).click();
    await openModule(page, VANILLA);
  }
  await sleep(page, 2000);
  return run;
}

async function startDrag(page: Page, moduleId: string) {
  const box = (await tab(page, moduleId).boundingBox())!;
  const x = box.x + box.width / 2 - 10;
  const y = box.y + box.height / 2;
  await mv(page, x, y);
  await page.mouse.down();
  await mv(page, x + 12, y + 12);
  await sleep(page, 700);
  return { x: x + 12, y: y + 12 };
}
async function moveTo(page: Page, from: { x: number; y: number }, x: number, y: number, steps = 18) {
  for (let i = 1; i <= steps; i++) {
    await mv(page, from.x + ((x - from.x) * i) / steps, from.y + ((y - from.y) * i) / steps);
    await sleep(page, pace);
  }
  for (const d of [1, 0, 1, 0]) {
    await mv(page, x + d, y);
    await sleep(page, 40);
  }
  return { x, y };
}
async function inGroup(page: Page, moduleId: string, fx: number, fy: number) {
  const b = (await group(page, moduleId).boundingBox())!;
  return { x: b.x + b.width * fx, y: b.y + b.height * fy };
}
let theApp: any;
const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/${theme}/${name}.png` });
const shotLive = (page: Page, name: string) => shootWindow(theApp, page, `${OUT}/${theme}/${name}.png`);
mkdirSync(`${OUT}/${theme}`, { recursive: true });

if (scene === "aim") {
  const { app, page } = await setup({ extraTab: true });
  theApp = app;
  const dockBox = (await page.locator(".dv-dockview").boundingBox())!;
  let p = await startDrag(page, VUE);
  await shot(page, "00-lifted");
  const aim = async (name: string, module: string, fx: number, fy: number) => {
    const to = await inGroup(page, module, fx, fy);
    p = await moveTo(page, p, to.x, to.y);
    await sleep(page, 500);
    await shot(page, name);
  };
  await aim("01-new-column-left", REACT, 0.1, 0.55);
  await aim("02-new-column-right", TODOS, 0.9, 0.55);
  await aim("03-new-row-top", TODOS, 0.5, 0.2);
  await aim("04-new-row-bottom", REACT, 0.5, 0.93);
  await aim("05-tab-centre", NOTES, 0.5, 0.6);
  const strip = (await tab(page, NOTES).boundingBox())!;
  p = await moveTo(page, p, strip.x + strip.width + 6, strip.y + strip.height / 2);
  await sleep(page, 500);
  await shot(page, "06-tab-strip-after-first");
  p = await moveTo(page, p, strip.x + 10, strip.y + strip.height / 2);
  await sleep(page, 500);
  await shot(page, "07-tab-strip-first");
  p = await moveTo(page, p, dockBox.x + 5, dockBox.y + dockBox.height / 2);
  await sleep(page, 500);
  await shot(page, "08-edge-left-full-height-column");
  p = await moveTo(page, p, dockBox.x + dockBox.width / 2, dockBox.y + dockBox.height - 5);
  await sleep(page, 500);
  await shot(page, "09-edge-bottom-full-width-row");
  p = await moveTo(page, p, 700, 30);
  await sleep(page, 400);
  await shot(page, "10-pointer-outside-dock");
  await page.mouse.up();
  await sleep(page, 800);
  await shotLive(page, "11-after-drop-outside-nothing-changed");
  await app.close();
} else if (scene === "refused") {
  const { app, page } = await setup({ size: [RAIL_WIDTH + 820, 560] });
  theApp = app;
  const dockBox = (await page.locator(".dv-dockview").boundingBox())!;
  let p = await startDrag(page, VUE);
  let to = await inGroup(page, REACT, 0.1, 0.55);
  p = await moveTo(page, p, to.x, to.y);
  await sleep(page, 500);
  await shot(page, "12-refused-new-column");
  p = await moveTo(page, p, dockBox.x + 5, dockBox.y + dockBox.height / 2);
  await sleep(page, 500);
  await shot(page, "13-refused-edge-column");
  p = await moveTo(page, p, 700, 30);
  await page.mouse.up();
  await app.close();
} else if (scene === "dropped") {
  const { app, page } = await setup();
  theApp = app;
  let p = await startDrag(page, VUE);
  const to = await inGroup(page, REACT, 0.1, 0.55);
  p = await moveTo(page, p, to.x, to.y);
  await sleep(page, 400);
  await page.mouse.up();
  await sleep(page, 2500);
  await shotLive(page, "14-after-drop-new-column");
  await app.close();
} else if (scene === "video") {
  const { app, page } = await setup({ extraTab: true });
  theApp = app;
  pace = 22;
  await shootWindow(app, page, `${OUT}/_before.png`);
  const cdp = await page.context().newCDPSession(page);
  const frames: { ts: number; data: string }[] = [];
  cdp.on("Page.screencastFrame", async (f: any) => {
    frames.push({ ts: f.metadata.timestamp, data: f.data });
    await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => undefined);
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 85, maxWidth: 1400, maxHeight: 900, everyNthFrame: 1 });
  const dock = (await page.locator(".dv-dockview").first().boundingBox())!;
  let p = await startDrag(page, VUE);
  let to = await inGroup(page, REACT, 0.12, 0.55);
  p = await moveTo(page, p, to.x, to.y, 40);
  await sleep(page, 900);
  to = await inGroup(page, TODOS, 0.5, 0.93);
  p = await moveTo(page, p, to.x, to.y, 40);
  await sleep(page, 900);
  to = await inGroup(page, NOTES, 0.5, 0.6);
  p = await moveTo(page, p, to.x, to.y, 40);
  await sleep(page, 700);
  const strip = (await tab(page, NOTES).boundingBox())!;
  p = await moveTo(page, p, strip.x + strip.width + 6, strip.y + strip.height / 2, 30);
  await sleep(page, 900);
  p = await moveTo(page, p, dock.x + 5, dock.y + dock.height / 2, 40);
  await sleep(page, 900);
  p = await moveTo(page, p, 700, 30, 30);
  await sleep(page, 200);
  await page.mouse.up();
  await sleep(page, 700);
  await cdp.send("Page.stopScreencast");
  await sleep(page, 800);
  await shootWindow(app, page, `${OUT}/_after.png`);
  const read = (n: string) => readFileSync(`${OUT}/${n}.png`).toString("base64");
  const before = read("_before");
  const after = read("_after");
  // A spare hidden window plays the frames to a canvas and records it as H.264.
  const [rec] = await Promise.all([
    app.waitForEvent("window"),
    app.evaluate(({ BrowserWindow }) => {
      const w = new BrowserWindow({ show: false, width: 1400, height: 900, webPreferences: { backgroundThrottling: false } });
      void w.loadURL("about:blank");
    }),
  ]);
  await rec.waitForLoadState();
  const b64 = await rec.evaluate(
    async ({ before, after, frames, trace, chip }) => {
      const W = 1400;
      const H = 900;
      const load = (b: string, type: string) => createImageBitmap(new Blob([Uint8Array.from(atob(b), (c) => c.charCodeAt(0))], { type }));
      const [bImg, aImg] = await Promise.all([load(before, "image/png"), load(after, "image/png")]);
      const fImgs = await Promise.all(frames.map((f) => load(f.data, "image/jpeg")));
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d")!;
      const stream = canvas.captureStream(0);
      const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame(): void };
      const rec = new MediaRecorder(stream, { mimeType: "video/mp4;codecs=avc1.42E01E", videoBitsPerSecond: 5_000_000 });
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const HOLD_IN = 0.8;
      const HOLD_OUT = 1.4;
      const t0 = frames[0]!.ts;
      const span = frames[frames.length - 1]!.ts - t0 + 0.25;
      const total = HOLD_IN + span + HOLD_OUT;
      const pointer = (t: number) => {
        let last = trace[0]!;
        for (const m of trace) if (m.t - t0 <= t) last = m;
        return last;
      };
      const draw = (t: number) => {
        ctx.clearRect(0, 0, W, H);
        if (t < HOLD_IN) ctx.drawImage(bImg, 0, 0, W, H);
        else if (t >= HOLD_IN + span) ctx.drawImage(aImg, 0, 0, W, H);
        else {
          const local = t - HOLD_IN;
          let idx = 0;
          for (let i = 0; i < frames.length; i++) if (frames[i]!.ts - t0 <= local) idx = i;
          ctx.drawImage(fImgs[idx]!, 0, 0, W, H);
          const m = pointer(local);
          const dragging = local >= (trace[1]?.t ?? 0) - t0;
          if (dragging) {
            ctx.save();
            ctx.globalAlpha = 0.9;
            ctx.fillStyle = "#1c1917";
            ctx.strokeStyle = "#e8a54b";
            ctx.lineWidth = 1.5;
            const w = 150;
            ctx.beginPath();
            ctx.roundRect(m.x + 14, m.y + 10, w, 28, 8);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = "#f5f5f4";
            ctx.font = "600 13px -apple-system, system-ui, sans-serif";
            ctx.fillText(chip, m.x + 26, m.y + 29);
            ctx.restore();
          }
          ctx.fillStyle = "#fff";
          ctx.strokeStyle = "#000";
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(m.x, m.y);
          ctx.lineTo(m.x, m.y + 17);
          ctx.lineTo(m.x + 4.5, m.y + 13);
          ctx.lineTo(m.x + 8, m.y + 20);
          ctx.lineTo(m.x + 10.5, m.y + 19);
          ctx.lineTo(m.x + 7, m.y + 12);
          ctx.lineTo(m.x + 12.5, m.y + 12);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
        track.requestFrame();
      };
      rec.start();
      const start = performance.now();
      await new Promise<void>((resolve) => {
        const tick = () => {
          const t = (performance.now() - start) / 1000;
          draw(Math.min(t, total));
          if (t >= total) resolve();
          else setTimeout(tick, 1000 / 30);
        };
        tick();
      });
      rec.stop();
      await new Promise((r) => (rec.onstop = r));
      const blob = new Blob(chunks, { type: "video/mp4" });
      return await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]!);
        reader.readAsDataURL(blob);
      });
    },
    { before, after, frames, trace, chip: "Vue Test Module" },
  );
  writeFileSync(`${OUT}/${scene === "video1" ? "video-1-drag-to-new-column" : "video-2-zones-tab-edge-and-cancel"}.mp4`, Buffer.from(b64, "base64"));
  writeFileSync(`${OUT}/docking-recommendation-drags-${theme}.mp4`, Buffer.from(b64, "base64"));
  console.log("frames", frames.length);
  await app.close();
}
