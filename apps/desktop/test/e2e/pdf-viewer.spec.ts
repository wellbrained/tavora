// The official PDF Viewer module: a PDF is added, drawn with its text, searched, and comes back as a tab after a restart.
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type ElectronApplication } from "@playwright/test";
import { inModule, launch, openModule, openWorkspace, panels, PDF_VIEWER } from "./harness";

const q = (testId: string) => `document.querySelector('[data-testid="${testId}"]')`;

/** A one-page PDF with a line of text (the xref is left for the reader to rebuild). */
function samplePdf(): string {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    "<< /Length 52 >>\nstream\nBT /F1 24 Tf 20 100 Td (Hello dragon world) Tj ET\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  objects.forEach((object, index) => (body += `${index + 1} 0 obj\n${object}\nendobj\n`));
  return Buffer.from(`${body}trailer\n<< /Root 1 0 R /Size 6 >>\n%%EOF\n`, "latin1").toString("base64");
}

/** Hands the module a file the way the file picker does. */
async function pick(app: ElectronApplication, name: string, type: string, base64: string) {
  await inModule(
    app,
    PDF_VIEWER,
    `(() => {
      const bytes = Uint8Array.from(atob(${JSON.stringify(base64)}), (c) => c.charCodeAt(0));
      const data = new DataTransfer();
      data.items.add(new File([bytes], ${JSON.stringify(name)}, { type: ${JSON.stringify(type)} }));
      const input = ${q("file-input")};
      input.files = data.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    })()`,
  );
}

test("pdf viewer: add a PDF, read and search it, and find the tab again after a restart", async () => {
  const first = await launch();
  await openWorkspace(first.page, "poe2");
  await openModule(first.page, PDF_VIEWER);
  await expect(panels(first.page, PDF_VIEWER)).toHaveCount(1);
  await expect.poll(() => inModule(first.app, PDF_VIEWER, `!!${q("empty")}`).catch(() => false), { timeout: 15_000 }).toBe(true);

  await pick(first.app, "Guide.pdf", "application/pdf", samplePdf());
  await expect.poll(() => inModule(first.app, PDF_VIEWER, `!!${q("pdf-pane")} && !!document.querySelector('[data-testid="pdf-page"] canvas')`), { timeout: 20_000 }).toBe(true);
  await expect
    .poll(() => inModule<string>(first.app, PDF_VIEWER, `document.querySelector('.textLayer')?.textContent ?? ""`), { timeout: 20_000 })
    .toContain("Hello dragon world");

  await inModule(first.app, PDF_VIEWER, `${q("pdf-search-toggle")}.click()`);
  await inModule(
    first.app,
    PDF_VIEWER,
    `(() => { const input = ${q("pdf-search-input")}; input.value = "DRAGON"; input.dispatchEvent(new Event("input", { bubbles: true })); })()`,
  );
  await expect.poll(() => inModule<string>(first.app, PDF_VIEWER, `${q("pdf-search-summary")}.textContent.trim()`)).toBe("1 of 1");
  await expect.poll(() => inModule(first.app, PDF_VIEWER, `document.querySelector('.textLayer mark[data-current]')?.textContent`)).toBe("dragon");

  await inModule(first.app, PDF_VIEWER, `${q("pdf-zoom-in")}.click()`);
  await expect.poll(() => inModule<string>(first.app, PDF_VIEWER, `${q("pdf-zoom")}.textContent.trim()`)).not.toBe("");
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await first.app.close();

  const second = await launch(first.userData);
  await openWorkspace(second.page, "poe2");
  await expect.poll(() => inModule(second.app, PDF_VIEWER, `!!${q("pdf-pane")}`).catch(() => false), { timeout: 20_000 }).toBe(true);
  await expect.poll(() => inModule<string>(second.app, PDF_VIEWER, `document.querySelector('[data-testid="file-name"]') ? "" : [...document.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent.trim()).join()`)).toContain("Guide.pdf");
  await second.app.close();
});

/** A PDF of `count` pages, each saying its number. */
function longPdf(count: number): string {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", ""];
  const kids: string[] = [];
  for (let number = 1; number <= count; number++) {
    const pageId = objects.length + 1;
    kids.push(`${pageId} 0 R`);
    const text = `BT /F1 24 Tf 20 100 Td (Page ${number}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Contents ${pageId + 1} 0 R /Resources << /Font << /F1 ${count * 2 + 3} 0 R >> >> >>`);
    objects.push(`<< /Length ${text.length} >>\nstream\n${text}\nendstream`);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${count} >>`;
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let body = "%PDF-1.4\n";
  objects.forEach((object, index) => (body += `${index + 1} 0 obj\n${object}\nendobj\n`));
  return Buffer.from(`${body}trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\n%%EOF\n`, "latin1").toString("base64");
}

test("pdf viewer: page pictures on the side jump to a page, and page keys move by whole pages", async () => {
  const { app, page } = await launch();
  await openModule(page, PDF_VIEWER);
  await expect.poll(() => inModule(app, PDF_VIEWER, `!!${q("empty")}`).catch(() => false), { timeout: 15_000 }).toBe(true);
  await pick(app, "Long.pdf", "application/pdf", longPdf(12));
  await expect.poll(() => inModule(app, PDF_VIEWER, `!!${q("pdf-pane")} && !!document.querySelector('[data-testid="pdf-page"] canvas')`), { timeout: 20_000 }).toBe(true);

  const pageField = () => inModule<string>(app, PDF_VIEWER, `${q("pdf-page-input")}.value`);
  await inModule(app, PDF_VIEWER, `${q("pdf-thumbs-toggle")}.click()`);
  await expect.poll(() => inModule<number>(app, PDF_VIEWER, `document.querySelectorAll('[data-testid="pdf-thumb"]').length`)).toBe(12);
  await expect.poll(() => inModule(app, PDF_VIEWER, `!!document.querySelector('[data-thumb="1"] canvas')`), { timeout: 15_000 }).toBe(true);

  await inModule(app, PDF_VIEWER, `document.querySelectorAll('[data-testid="pdf-thumb"]')[7].click()`);
  await expect.poll(pageField).toBe("8");
  await expect.poll(() => inModule(app, PDF_VIEWER, `document.querySelector('[data-testid="pdf-thumb"][aria-current="page"]')?.textContent.trim()`)).toBe("8");

  const press = (key: string) => inModule(app, PDF_VIEWER, `(() => { const pane = ${q("pdf-scroller")}; pane.focus(); pane.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(key)}, bubbles: true })); })()`);
  await press("End");
  await expect.poll(pageField).toBe("12");
  await press("PageUp");
  await expect.poll(pageField).toBe("11");
  await press("Home");
  await expect.poll(pageField).toBe("1");
  await press("PageDown");
  await expect.poll(pageField).toBe("2");
  await app.close();
});

test("pdf viewer: a picture opens in the zoom pane and a file that is not a PDF or picture is refused", async () => {
  const { app, page } = await launch();
  await openModule(page, PDF_VIEWER);
  await expect.poll(() => inModule(app, PDF_VIEWER, `!!${q("empty")}`).catch(() => false), { timeout: 15_000 }).toBe(true);

  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
  await pick(app, "Pixel.png", "image/png", png);
  await expect.poll(() => inModule(app, PDF_VIEWER, `!!${q("image-view")}`), { timeout: 15_000 }).toBe(true);

  await pick(app, "Notes.txt", "text/plain", Buffer.from("hello").toString("base64"));
  await expect.poll(() => inModule(app, PDF_VIEWER, `!!${q("notice-toast")}`)).toBe(true);
  await app.close();
});

/** Builds a PDF from its objects (strings, or bytes for an encrypted stream); the xref is left for the reader to rebuild. */
function buildPdf(objects: (string | Buffer)[], trailer: string): string {
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n", "latin1")];
  objects.forEach((object, index) => parts.push(Buffer.from(`${index + 1} 0 obj\n`, "latin1"), typeof object === "string" ? Buffer.from(object, "latin1") : object, Buffer.from("\nendobj\n", "latin1")));
  parts.push(Buffer.from(`trailer\n<< /Root 1 0 R /Size ${objects.length + 1} ${trailer}>>\n%%EOF\n`, "latin1"));
  return Buffer.concat(parts).toString("base64");
}

/** Two pages; the first has a link to the second and a link to a web address. */
function linkedPdf(): string {
  const first = "BT /F1 18 Tf 20 320 Td (To page two) Tj 0 -100 Td (To the web) Tj ET";
  const second = "BT /F1 18 Tf 20 320 Td (Page two) Tj ET";
  return buildPdf(
    [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Contents 4 0 R /Resources << /Font << /F1 9 0 R >> >> /Annots [7 0 R 8 0 R] >>",
      `<< /Length ${first.length} >>\nstream\n${first}\nendstream`,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Contents 6 0 R /Resources << /Font << /F1 9 0 R >> >> >>",
      `<< /Length ${second.length} >>\nstream\n${second}\nendstream`,
      "<< /Type /Annot /Subtype /Link /Rect [15 310 160 345] /Border [0 0 0] /Dest [5 0 R /XYZ null null null] >>",
      "<< /Type /Annot /Subtype /Link /Rect [15 210 160 245] /Border [0 0 0] /A << /S /URI /URI (https://example.com/guide) >> >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ],
    "",
  );
}

function rc4(key: Buffer, data: Buffer): Buffer {
  const box = Array.from({ length: 256 }, (_, index) => index);
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + box[i]! + key[i % key.length]!) & 255;
    [box[i], box[j]] = [box[j]!, box[i]!];
  }
  const out = Buffer.alloc(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 255;
    j = (j + box[i]!) & 255;
    [box[i], box[j]] = [box[j]!, box[i]!];
    out[k] = data[k]! ^ box[(box[i]! + box[j]!) & 255]!;
  }
  return out;
}

/** A one-page PDF locked with `password` (the standard 40-bit RC4 lock, revision 2). */
function lockedPdf(password: string): string {
  const PAD = Buffer.from("28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A", "hex");
  const pad = (text: string) => Buffer.concat([Buffer.from(text, "latin1"), PAD]).subarray(0, 32);
  const md5 = (...parts: Buffer[]) => createHash("md5").update(Buffer.concat(parts)).digest();
  const id = Buffer.from("0123456789abcdef0123456789abcdef", "hex");
  const owner = rc4(md5(pad("owner")).subarray(0, 5), pad(password));
  const permissions = Buffer.alloc(4);
  permissions.writeInt32LE(-4);
  const key = md5(pad(password), owner, permissions, id).subarray(0, 5);
  const user = rc4(key, PAD);
  // The page text is object 4, so it is locked with the key for object 4, generation 0.
  const text = rc4(md5(key, Buffer.from([4, 0, 0, 0, 0])).subarray(0, 10), Buffer.from("BT /F1 24 Tf 20 100 Td (Secret dragon) Tj ET", "latin1"));
  return buildPdf(
    [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
      Buffer.concat([Buffer.from(`<< /Length ${text.length} >>\nstream\n`, "latin1"), text, Buffer.from("\nendstream", "latin1")]),
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      `<< /Filter /Standard /V 1 /R 2 /O <${owner.toString("hex")}> /U <${user.toString("hex")}> /P -4 >>`,
    ],
    `/Encrypt 6 0 R /ID [<${id.toString("hex")}> <${id.toString("hex")}>] `,
  );
}

const typePassword = (app: ElectronApplication, text: string) =>
  inModule(app, PDF_VIEWER, `(() => { const input = ${q("pdf-password-input")}; input.value = ${JSON.stringify(text)}; input.dispatchEvent(new Event("input", { bubbles: true })); })()`);

test("pdf viewer: a link to another page jumps there, and a web link goes to Tavora to open", async () => {
  const { app, page } = await launch();
  await openModule(page, PDF_VIEWER);
  await expect.poll(() => inModule(app, PDF_VIEWER, `!!${q("empty")}`).catch(() => false), { timeout: 15_000 }).toBe(true);
  await pick(app, "Links.pdf", "application/pdf", linkedPdf());
  await expect.poll(() => inModule<number>(app, PDF_VIEWER, `document.querySelectorAll('[data-page="1"] [data-testid="pdf-link"]').length`), { timeout: 20_000 }).toBe(2);

  const link = (web: boolean) => `[...document.querySelectorAll('[data-page="1"] [data-testid="pdf-link"]')].find((button) => button.title.includes("example.com") === ${web})`;
  await inModule(app, PDF_VIEWER, `${link(false)}.click()`);
  await expect.poll(() => inModule<string>(app, PDF_VIEWER, `${q("pdf-page-input")}.value`)).toBe("2");

  // The page did not move away from the module, and a real click on the web link asks where to open it.
  await inModule(app, PDF_VIEWER, `${q("pdf-prev")}.click()`);
  await expect.poll(() => inModule<string>(app, PDF_VIEWER, `${q("pdf-page-input")}.value`)).toBe("1");
  const box = await inModule<{ x: number; y: number }>(app, PDF_VIEWER, `(() => { const button = ${link(true)}; button.scrollIntoView({ block: "center" }); const r = button.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  await app.evaluate(({ webContents }, { moduleId, x, y }) => {
    const target = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(`tavora-module://${moduleId}/`))!;
    for (const type of ["mouseDown", "mouseUp"] as const) target.sendInputEvent({ type, x, y, button: "left", clickCount: 1 });
  }, { moduleId: PDF_VIEWER, ...box });
  await expect(page.getByTestId("link-choice-url")).toHaveText("https://example.com/guide");
  await page.getByTestId("link-choice-cancel").click();
  expect(await inModule<string>(app, PDF_VIEWER, "location.href")).toMatch(/^tavora-module:/);
  await app.close();
});

test("pdf viewer: a locked PDF asks for its password, again after a wrong one, and Cancel closes it", async () => {
  const { app, page } = await launch();
  await openModule(page, PDF_VIEWER);
  await expect.poll(() => inModule(app, PDF_VIEWER, `!!${q("empty")}`).catch(() => false), { timeout: 15_000 }).toBe(true);

  await pick(app, "Locked.pdf", "application/pdf", lockedPdf("dragon"));
  await expect.poll(() => inModule(app, PDF_VIEWER, `!!${q("pdf-password")}`), { timeout: 20_000 }).toBe(true);
  await typePassword(app, "nope");
  await inModule(app, PDF_VIEWER, `${q("pdf-password-open")}.click()`);
  await expect.poll(() => inModule(app, PDF_VIEWER, `!!${q("pdf-password-wrong")}`), { timeout: 15_000 }).toBe(true);
  expect(await inModule<string>(app, PDF_VIEWER, `${q("pdf-password-input")}.value`)).toBe("");
  await typePassword(app, "dragon");
  await inModule(app, PDF_VIEWER, `${q("pdf-password-open")}.click()`);
  await expect
    .poll(() => inModule<string>(app, PDF_VIEWER, `document.querySelector('.textLayer')?.textContent ?? ""`), { timeout: 20_000 })
    .toContain("Secret dragon");

  await pick(app, "Locked again.pdf", "application/pdf", lockedPdf("dragon"));
  await expect.poll(() => inModule(app, PDF_VIEWER, `!!${q("pdf-password")}`), { timeout: 20_000 }).toBe(true);
  await inModule(app, PDF_VIEWER, `${q("pdf-password-cancel")}.click()`);
  await expect.poll(() => inModule(app, PDF_VIEWER, `!!${q("file-list")}`)).toBe(true);
  await expect.poll(() => inModule<string>(app, PDF_VIEWER, `[...document.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent.trim()).join()`)).not.toContain("Locked again.pdf");
  await app.close();
});

/** A real click in the module's page on the element `selector` finds, so the host counts it as the user's. */
async function press(app: ElectronApplication, selector: string) {
  const where = () => inModule<string>(app, PDF_VIEWER, `(() => { const element = document.querySelector(${JSON.stringify(selector)}); element.scrollIntoView({ block: "center" }); const r = element.getBoundingClientRect(); return r.width ? JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }) : ""; })()`);
  // Wait until it stands still: a panel that just opened is still laying itself out.
  let box = "";
  await expect.poll(async () => { const last = box; box = await where(); return box !== "" && box === last; }).toBe(true);
  await app.evaluate(({ webContents }, { moduleId, x, y }) => {
    const target = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(`tavora-module://${moduleId}/`))!;
    for (const type of ["mouseDown", "mouseUp"] as const) target.sendInputEvent({ type, x, y, button: "left", clickCount: 1 });
  }, { moduleId: PDF_VIEWER, ...(JSON.parse(box) as { x: number; y: number }) });
}

test("pdf viewer: files picked in Tavora's dialog stay linked to their original", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "tavora-pdf-originals-"));
  const rules = path.join(folder, "Rules.pdf");
  const map = path.join(folder, "Map.pdf");
  await writeFile(rules, Buffer.from(samplePdf(), "base64"));
  await writeFile(map, Buffer.from(longPdf(2), "base64"));
  const { app, page } = await launch();
  try {
    await app.evaluate(({ dialog, shell }, picked) => {
      const seen = globalThis as { dialogOptions?: unknown; shownInFolder?: string[] };
      seen.shownInFolder = [];
      dialog.showOpenDialog = (async (_window: unknown, options: unknown) => ((seen.dialogOptions = options), { canceled: false, filePaths: picked })) as unknown as typeof dialog.showOpenDialog;
      shell.showItemInFolder = (place: string) => void seen.shownInFolder!.push(place);
    }, [rules, map]);
    await openModule(page, PDF_VIEWER);
    await expect.poll(() => inModule(app, PDF_VIEWER, `!!${q("empty")}`).catch(() => false), { timeout: 15_000 }).toBe(true);

    // One pick, two files: both get a tab, and the dialog let the user choose several.
    await press(app, '[data-testid="empty-open"]');
    const tabNames = () => inModule<string>(app, PDF_VIEWER, `[...document.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent.trim()).join()`);
    await expect.poll(tabNames, { timeout: 20_000 }).toBe("Rules.pdf,Map.pdf");
    expect(await app.evaluate(() => ((globalThis as { dialogOptions?: { properties?: string[] } }).dialogOptions?.properties ?? []))).toContain("multiSelections");
    const tabAt = async (name: string) => inModule<number>(app, PDF_VIEWER, `[...document.querySelectorAll('[role="tab"]')].findIndex((tab) => tab.textContent.trim() === ${JSON.stringify(name)})`);
    const select = async (name: string) => {
      const index = await tabAt(name);
      await inModule(app, PDF_VIEWER, `document.querySelectorAll('[role="tab"]')[${index}].setAttribute("data-e2e-target", "")`);
      await press(app, "[data-e2e-target]");
      await inModule(app, PDF_VIEWER, `document.querySelector("[data-e2e-target]")?.removeAttribute("data-e2e-target")`);
    };

    // The original changes: back on its tab, the bar offers to reload, and Reload shows the new version.
    await writeFile(rules, Buffer.from(longPdf(3), "base64"));
    await select("Rules.pdf");
    await expect.poll(() => inModule(app, PDF_VIEWER, `!!${q("original-changed")}`), { timeout: 15_000 }).toBe(true);
    await inModule(app, PDF_VIEWER, `${q("original-reload")}.click()`);
    await expect.poll(() => inModule(app, PDF_VIEWER, `!!${q("original-changed")}`)).toBe(false);
    await expect.poll(() => inModule<string>(app, PDF_VIEWER, `document.querySelector('.textLayer')?.textContent ?? ""`), { timeout: 20_000 }).toContain("Page 1");
    await expect.poll(() => inModule<number>(app, PDF_VIEWER, `document.querySelectorAll('[data-testid="pdf-page"]').length`), { timeout: 20_000 }).toBe(3);

    // Show in folder, from the file list's menu, hands Tavora the original's place.
    await press(app, '[data-testid="file-list-toggle"]');
    await expect.poll(() => inModule(app, PDF_VIEWER, `!!${q("file-list")}`)).toBe(true);
    await press(app, '[data-testid="file-list"] li:first-child [data-testid="file-menu"]');
    await expect.poll(() => inModule(app, PDF_VIEWER, `!!${q("file-show-in-folder")}`)).toBe(true);
    await press(app, '[data-testid="file-show-in-folder"]');
    await expect.poll(() => app.evaluate(() => (globalThis as { shownInFolder?: string[] }).shownInFolder ?? [])).toEqual([rules]);
    await page.keyboard.press("Escape");

    // The original is gone: the bar offers to remove the file, and Keep my copy keeps it without the link.
    await rm(rules);
    await select("Map.pdf");
    await select("Rules.pdf");
    await expect.poll(() => inModule(app, PDF_VIEWER, `!!${q("original-gone")}`), { timeout: 15_000 }).toBe(true);
    await inModule(app, PDF_VIEWER, `${q("original-keep")}.click()`);
    await expect.poll(() => inModule(app, PDF_VIEWER, `!!${q("original-gone")}`)).toBe(false);
    expect(await tabNames()).toBe("Rules.pdf,Map.pdf");

    // Gone again for the other file: Remove closes its tab and takes it off the list.
    await rm(map);
    await select("Map.pdf");
    await expect.poll(() => inModule(app, PDF_VIEWER, `!!${q("original-gone")}`), { timeout: 15_000 }).toBe(true);
    await inModule(app, PDF_VIEWER, `${q("original-remove")}.click()`);
    await expect.poll(tabNames).toBe("Rules.pdf");
  } finally {
    await app.close();
    await rm(folder, { recursive: true, force: true });
  }
});
