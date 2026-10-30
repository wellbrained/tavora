// pdf.js, set up for a module: the worker and the data it reads come from the module's own files, nothing runs
// from a string (no eval) and WebAssembly is left off, so the plain-JavaScript decoders are used.

import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjs };
export type { PDFDocumentProxy };

const folder = (name: string) => new URL(`./pdfjs/${name}/`, window.location.href).href;

/** Why a PDF could not be opened, as far as the reader needs to know. */
export class PdfProblem extends Error {
  constructor(readonly kind: "gone" | "password" | "broken") {
    super(kind);
  }
}

/** Reads a stored file and opens it. */
export async function openPdf(url: string): Promise<PDFDocumentProxy> {
  let bytes: Uint8Array;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new PdfProblem("gone");
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    throw error instanceof PdfProblem ? error : new PdfProblem("gone");
  }
  try {
    return await pdfjs.getDocument({
      data: bytes,
      useWasm: false,
      enableXfa: false,
      cMapUrl: folder("cmaps"),
      cMapPacked: true,
      standardFontDataUrl: folder("standard_fonts"),
      wasmUrl: folder("wasm"),
    }).promise;
  } catch (error) {
    throw new PdfProblem((error as { name?: string })?.name === "PasswordException" ? "password" : "broken");
  }
}

/** One entry of a PDF's contents list, with the page it points to once that is known. */
export interface OutlineNode {
  title: string;
  page: number | null;
  items: OutlineNode[];
}

interface RawOutline {
  title: string;
  dest: string | unknown[] | null;
  items: RawOutline[];
}

async function pageOf(pdf: PDFDocumentProxy, dest: RawOutline["dest"]): Promise<number | null> {
  try {
    const resolved = typeof dest === "string" ? await pdf.getDestination(dest) : dest;
    const target = resolved?.[0];
    if (target === null || target === undefined) return null;
    if (typeof target === "number") return target + 1;
    return (await pdf.getPageIndex(target as Parameters<PDFDocumentProxy["getPageIndex"]>[0])) + 1;
  } catch {
    return null;
  }
}

/** The contents list (table of contents) with page numbers; empty when the PDF has none. */
export async function loadOutline(pdf: PDFDocumentProxy): Promise<OutlineNode[]> {
  const raw = (await pdf.getOutline().catch(() => null)) as RawOutline[] | null;
  const build = async (items: RawOutline[]): Promise<OutlineNode[]> =>
    Promise.all(items.map(async (item) => ({ title: item.title, page: await pageOf(pdf, item.dest), items: await build(item.items ?? []) })));
  return raw ? build(raw) : [];
}

/** Lets go of an opened PDF and the memory it holds. */
export async function closePdf(pdf: PDFDocumentProxy | null): Promise<void> {
  await pdf?.loadingTask.destroy().catch(() => undefined);
}
