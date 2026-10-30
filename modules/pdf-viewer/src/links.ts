// Links on a PDF page: where each one leads and where it sits. Links to another page jump there in the viewer; web
// addresses go to Tavora (links.open), which opens them in the Browser panel. Anything else (mail, files, scripts)
// stays inert.

/** Where a link leads, as far as the viewer can follow it. */
export type LinkTarget =
  | { kind: "web"; url: string }
  | { kind: "dest"; dest: string | unknown[] }
  | { kind: "named"; action: NamedAction };

export type NamedAction = "NextPage" | "PrevPage" | "FirstPage" | "LastPage";
const NAMED: readonly string[] = ["NextPage", "PrevPage", "FirstPage", "LastPage"];

/** The parts of a pdf.js annotation that matter for a link. */
export interface RawLink {
  subtype?: string;
  rect?: number[];
  url?: string;
  unsafeUrl?: string;
  dest?: string | unknown[] | null;
  action?: string;
}

/** An http or https address, written out in full; null for anything else. */
export function webAddress(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/** Where a link annotation leads; null when it is not a link or leads nowhere the viewer can go. */
export function linkTarget(annotation: RawLink): LinkTarget | null {
  if (annotation.subtype !== "Link") return null;
  // pdf.js fills `url` only with an address it checked; `unsafeUrl` is the raw text and is left alone.
  if (annotation.url) {
    const url = webAddress(annotation.url);
    return url ? { kind: "web", url } : null;
  }
  if (typeof annotation.dest === "string" || Array.isArray(annotation.dest)) return { kind: "dest", dest: annotation.dest };
  if (annotation.action && NAMED.includes(annotation.action)) return { kind: "named", action: annotation.action as NamedAction };
  return null;
}

/** The page (1-based) a named action leads to from `page`, kept inside the document. */
export function namedPage(action: NamedAction, page: number, count: number): number {
  const target = action === "NextPage" ? page + 1 : action === "PrevPage" ? page - 1 : action === "FirstPage" ? 1 : count;
  return Math.min(count, Math.max(1, target));
}

/** Where a link sits on its page, in percent from the top left; `view` is the page's box in PDF units. */
export function linkBox(rect: readonly number[], view: readonly number[]): { left: number; top: number; width: number; height: number } | null {
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = view;
  const width = x1 - x0;
  const height = y1 - y0;
  if (width <= 0 || height <= 0 || rect.length < 4) return null;
  const [ax, ay, bx, by] = rect as [number, number, number, number];
  const left = Math.min(ax, bx) - x0;
  const top = y1 - Math.max(ay, by);
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return {
    left: round((left / width) * 100),
    top: round((top / height) * 100),
    width: round((Math.abs(bx - ax) / width) * 100),
    height: round((Math.abs(by - ay) / height) * 100),
  };
}
