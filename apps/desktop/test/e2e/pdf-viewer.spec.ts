// The official PDF Viewer module: a PDF is added, drawn with its text, searched, and comes back as a tab after a restart.
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
