import { expect, it } from "vitest";
import type { Session } from "electron";
import { PURGE_WINDOW_MS, PurgeCount, viewsInSession } from "./storage-purge";

const session = (name: string) => ({ name }) as unknown as Session;
const view = (moduleId: string, ses: Session, destroyed = false) => ({ moduleId, view: { webContents: { session: ses, isDestroyed: () => destroyed } } });

it("takes only the module's panels in the session that is over, even when another workspace's is listed first", () => {
  const kept = session("workspace A"), full = session("workspace B");
  const views = [view("m", kept), view("m", full), view("other", full), view("m", full, true)];
  expect(viewsInSession(views, "m", full)).toEqual([views[1]]);
  expect(viewsInSession(views, "m", kept)).toEqual([views[0]]);
});

it("starts the panels again after the first purge, and leaves them stopped after a second one within ten minutes", () => {
  let now = 0;
  const count = new PurgeCount(() => now);
  expect(count.note("m@a")).toBe(true);
  now += PURGE_WINDOW_MS - 1;
  expect(count.note("m@a")).toBe(false);
  // Reloaded by the user and over again at once: still stopped.
  now += 1_000;
  expect(count.note("m@a")).toBe(false);
  // Another module, or the same one in another workspace, counts on its own.
  expect(count.note("m@b")).toBe(true);
  expect(count.note("other@a")).toBe(true);
});

it("counts a purge long after the last one as a first one again", () => {
  let now = 0;
  const count = new PurgeCount(() => now);
  expect(count.note("m@a")).toBe(true);
  now += PURGE_WINDOW_MS;
  expect(count.note("m@a")).toBe(true);
});
