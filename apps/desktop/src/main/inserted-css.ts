// One user stylesheet in a page that is replaced as a whole: the new one goes in before the old one comes out, one swap at
// a time, so a page is never without it and none is left behind. The same sheet again changes nothing, so a caller can
// hand over its sheet on every change and only a real one costs a swap (a font's sheet is big).
import type { WebContents } from "electron";

export class InsertedCss {
  private key: string | undefined;
  /** The sheet the page has, or is getting. */
  private css: string | undefined;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly contents: () => Pick<WebContents, "insertCSS" | "removeInsertedCSS">) {}

  /** A new document starts without the old one's sheets: the next swap only inserts. */
  forget(): void {
    this.css = undefined;
    this.queue = this.queue.then(() => void (this.key = undefined));
  }

  replace(css: string): Promise<void> {
    if (css === this.css) return this.queue;
    this.css = css;
    this.queue = this.queue.then(async () => {
      const previous = this.key;
      try {
        const contents = this.contents();
        this.key = await contents.insertCSS(css, { cssOrigin: "user" });
        if (previous) await contents.removeInsertedCSS(previous);
      } catch {
        // The page went away; the next one gets its sheet on dom-ready.
      }
    });
    return this.queue;
  }
}
