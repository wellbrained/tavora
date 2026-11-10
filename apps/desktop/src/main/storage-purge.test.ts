import { expect, it } from "vitest";
import type { Session } from "electron";
import { viewsInSession } from "./storage-purge";

const session = (name: string) => ({ name }) as unknown as Session;
const view = (moduleId: string, ses: Session, destroyed = false) => ({ moduleId, view: { webContents: { session: ses, isDestroyed: () => destroyed } } });

it("takes only the module's panels in the session that is over, even when another workspace's is listed first", () => {
  const kept = session("workspace A"), full = session("workspace B");
  const views = [view("m", kept), view("m", full), view("other", full), view("m", full, true)];
  expect(viewsInSession(views, "m", full)).toEqual([views[1]]);
  expect(viewsInSession(views, "m", kept)).toEqual([views[0]]);
});
