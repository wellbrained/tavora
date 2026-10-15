import { createHash } from "node:crypto";
import type { IconState, PendingRow } from "./icon-state.ts";
import { isIconId, type IconStore } from "./icons.ts";
import { icoToPng, inspectPng, stripPng } from "./png.ts";

/**
 * Icons offered by players' apps, and what happens to them. An offer is
 * checked, cleaned and put in a queue; nothing is served until a person
 * approves it on the private review page. The service never records who
 * offered a file.
 */

export const MAX_UPLOAD_BODY = 400_000;
export const MIN_ICON_PIXELS = 32;
export const MAX_PENDING = 300;
export const MAX_PENDING_PER_GAME = 5;
const SOURCES = new Set(["installed", "steam", "other"]);

export type SubmitResult = { status: 202 } | { status: 400 | 409 | 413 | 503; error: string };

export interface SubmissionsOptions {
  state: IconState;
  /** What is served now, to refuse an icon for a game that already has one. */
  store: IconStore;
  /** The name of a game in the dataset, or null when there is no such game. */
  gameName: (id: string) => string | null;
  now?: () => Date;
}

const decodeBase64 = (value: string): Uint8Array | null => {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return null;
  return new Uint8Array(Buffer.from(value, "base64"));
};

export function createSubmissions({ state, store, gameName, now = () => new Date() }: SubmissionsOptions) {
  return {
    /** Checks an offered icon and queues it. The same answer for a new offer, a repeat and a blocked file, so nothing can be probed. */
    submit(input: unknown): SubmitResult {
      const body = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
      const { id, name, source, icon } = body;
      if (!isIconId(id) || typeof icon !== "string" || icon.length === 0) return { status: 400, error: "Send { id, name, source, icon }." };
      if (icon.length > MAX_UPLOAD_BODY) return { status: 413, error: "That icon is too big." };
      const canonicalName = gameName(id);
      if (canonicalName === null) return { status: 400, error: "That game is not known to Tavora." };
      if (store.list().some((entry) => entry.id === id)) return { status: 409, error: "That game already has an icon." };

      const raw = decodeBase64(icon);
      if (!raw) return { status: 400, error: "The icon must be base64." };
      const png = inspectPng(raw) ? raw : icoToPng(raw);
      const clean = png ? stripPng(png) : null;
      const size = clean ? inspectPng(clean) : null;
      if (!clean || !size) return { status: 400, error: "Send a PNG or an .ico of at most 256 px." };
      if (size.width < MIN_ICON_PIXELS || size.height < MIN_ICON_PIXELS) return { status: 400, error: `The icon must be at least ${MIN_ICON_PIXELS} px.` };

      const sha256 = createHash("sha256").update(clean).digest("hex");
      // Blocked files, a full queue and a game with enough offers already are quietly not kept.
      if (state.isBlocked(sha256)) return { status: 202 };
      if (state.pendingCount() >= MAX_PENDING) return { status: 503, error: "Too many icons are waiting for review right now." };
      if (state.pendingCount(id) >= MAX_PENDING_PER_GAME && state.pending(sha256) === null) return { status: 202 };
      state.addPending({
        sha256,
        id,
        name: typeof name === "string" && name.trim() ? name.trim().slice(0, 120) : canonicalName,
        source: typeof source === "string" && SOURCES.has(source) ? source : "other",
        bytes: clean,
        now: now(),
      });
      return { status: 202 };
    },

    listPending(): Array<PendingRow & { gameName: string | null; hasIcon: boolean }> {
      const hosted = new Set(store.list().map((entry) => entry.id));
      return state.listPending().map((row) => ({ ...row, gameName: gameName(row.id), hasIcon: hosted.has(row.id) }));
    },

    /** Publishes an offered icon. The game's own name and the name it was offered under both match it. */
    approve(sha256: string): { ok: true; id: string } | { ok: false; error: string } {
      const row = state.pending(sha256);
      if (!row) return { ok: false, error: "No such offer." };
      if (store.list().some((entry) => entry.id === row.id)) return { ok: false, error: "That game already has an icon. Take it down first." };
      const canonical = gameName(row.id);
      const names = [...new Set([canonical ?? row.name, row.name])];
      state.approve(sha256, names, now());
      return { ok: true, id: row.id };
    },

    /** Drops an offer; blocking also refuses the same file for ever. */
    deny(sha256: string, block: boolean): boolean {
      if (block) {
        const had = state.pending(sha256) !== null;
        state.block(sha256, "denied", now());
        return had;
      }
      return state.deletePending(sha256);
    },

    /** Takes a hosted icon down (a publisher's request): it stops being served at once; blocking also refuses the same file again. */
    takedown(id: string, block: boolean): boolean {
      const entry = store.list().find((icon) => icon.id === id);
      if (!entry) return false;
      if (!state.removeApproved(id)) state.hide(id, now());
      if (block) state.block(entry.sha256, "takedown", now());
      return true;
    },
  };
}

export type Submissions = ReturnType<typeof createSubmissions>;
