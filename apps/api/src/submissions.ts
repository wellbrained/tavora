import { createHash } from "node:crypto";
import type { IconState, PendingRow } from "./icon-state.ts";
import { LOCAL_PREFIX, slugify } from "./ids.ts";
import { isIconId, type IconStore } from "./icons.ts";
import { icoToPng, inspectPng, stripPng } from "./png.ts";

/**
 * Icons offered by users' apps, and what happens to them. Only a signed-in
 * user can offer one. An offer is checked, cleaned and put in a queue;
 * nothing is served until a person approves it on the private review page.
 * The account that sent it is kept only while it waits, so blocking a bad
 * offer can also stop its sender.
 *
 * A game the user added by name (a `local-` id) is offered under its name:
 * a game in the dataset with that name gets it under its own id, and a name
 * no game has becomes a custom game the icon is listed for by that name.
 */

export const MAX_UPLOAD_BODY = 400_000;
export const MIN_ICON_PIXELS = 32;
export const MAX_PENDING = 300;
export const MAX_PENDING_PER_GAME = 5;
/** Different offers one account may have waiting at once. */
export const MAX_PENDING_PER_SENDER = 100;
const SOURCES = new Set(["installed", "steam", "other"]);

export type SubmitResult = { status: 202 } | { status: 400 | 409 | 413 | 429 | 503; error: string };

export interface SubmissionsOptions {
  state: IconState;
  /** What is served now, to refuse an icon for a game that already has one (unless it is open for replacements). */
  store: IconStore;
  /** The name of a game in the dataset, or null when there is no such game. */
  gameName: (id: string) => string | null;
  /** The ids of the dataset's games with this name or alias (case, accents and apostrophes ignored). */
  gamesNamed: (name: string) => string[];
  now?: () => Date;
}

const decodeBase64 = (value: string): Uint8Array | null => {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return null;
  return new Uint8Array(Buffer.from(value, "base64"));
};

/** A game name as the user typed it: printable, trimmed, at most 120 characters; null for anything else. */
const cleanName = (input: unknown): string | null => {
  if (typeof input !== "string" || /[\u0000-\u001f\u007f-\u009f]/.test(input)) return null;
  const name = input.trim();
  return name && name.length <= 120 ? name : null;
};

export function createSubmissions({ state, store, gameName, gamesNamed, now = () => new Date() }: SubmissionsOptions) {
  /**
   * The game an offer is for: a dataset game by its id, or for a `local-` id the dataset game with the offered
   * name, else a custom game named that. Null when it cannot be told which game it is.
   */
  const gameFor = (id: string, name: unknown): { id: string; name: string } | null => {
    if (!id.startsWith(LOCAL_PREFIX)) {
      const canonical = gameName(id);
      return canonical === null ? null : { id, name: canonical };
    }
    const offered = cleanName(name);
    if (offered === null) return null;
    const named = [...new Set(gamesNamed(offered))];
    // Several games share the name: the icon could be any of theirs.
    if (named.length > 1) return null;
    if (named.length === 1) {
      const canonical = gameName(named[0]!);
      return canonical === null ? null : { id: named[0]!, name: canonical };
    }
    const slug = slugify(offered).slice(0, 64 - LOCAL_PREFIX.length).replace(/-+$/, "");
    return slug ? { id: `${LOCAL_PREFIX}${slug}`, name: offered } : null;
  };

  return {
    /**
     * Checks an icon a signed-in user (`sender`, the account id) offers and queues it. The same answer for a new
     * offer, a repeat, a blocked file and a blocked account, so nothing can be probed.
     */
    submit(input: unknown, sender: string): SubmitResult {
      const body = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
      const { name, source, icon } = body;
      if (!isIconId(body.id) || typeof icon !== "string" || icon.length === 0) return { status: 400, error: "Send { id, name, source, icon }." };
      if (icon.length > MAX_UPLOAD_BODY) return { status: 413, error: "That icon is too big." };
      const game = gameFor(body.id, name);
      if (game === null) return { status: 400, error: "That game is not known to Tavora." };
      const { id, name: canonicalName } = game;
      if (store.list().some((entry) => entry.id === id) && !state.isReplaceable(id)) return { status: 409, error: "That game already has an icon." };

      const raw = decodeBase64(icon);
      if (!raw) return { status: 400, error: "The icon must be base64." };
      const png = inspectPng(raw) ? raw : icoToPng(raw);
      const clean = png ? stripPng(png) : null;
      const size = clean ? inspectPng(clean) : null;
      if (!clean || !size) return { status: 400, error: "Send a PNG or an .ico of at most 256 px." };
      if (size.width < MIN_ICON_PIXELS || size.height < MIN_ICON_PIXELS) return { status: 400, error: `The icon must be at least ${MIN_ICON_PIXELS} px.` };

      const sha256 = createHash("sha256").update(clean).digest("hex");
      // Blocked files and accounts, a full queue and a game with enough offers already are quietly not kept.
      if (state.isBlocked(sha256) || state.isSenderBlocked(sender)) return { status: 202 };
      if (state.pendingCount() >= MAX_PENDING) return { status: 503, error: "Too many icons are waiting for review right now." };
      if (state.pendingCountFrom(sender) >= MAX_PENDING_PER_SENDER && state.pending(sha256) === null) {
        return { status: 429, error: "You have lots of icons waiting for review. Try again later." };
      }
      if (state.pendingCount(id) >= MAX_PENDING_PER_GAME && state.pending(sha256) === null) return { status: 202 };
      state.addPending({
        sha256,
        id,
        name: typeof name === "string" && name.trim() ? name.trim().slice(0, 120) : canonicalName,
        source: typeof source === "string" && SOURCES.has(source) ? source : "other",
        bytes: clean,
        sender,
        now: now(),
      });
      return { status: 202 };
    },

    /**
     * The waiting offers, with the dataset's name for the game (a custom game's is the name it was offered under).
     * `replaces`: the game has an icon that is open for replacements, so approving this one replaces it.
     */
    listPending(): Array<PendingRow & { gameName: string | null; custom: boolean; hasIcon: boolean; replaces: boolean }> {
      const hosted = new Set(store.list().map((entry) => entry.id));
      const open = state.replaceableIds();
      return state.listPending().map((row) => {
        const custom = row.id.startsWith(LOCAL_PREFIX);
        const hasIcon = hosted.has(row.id);
        return { ...row, gameName: custom ? row.name : gameName(row.id), custom, hasIcon, replaces: hasIcon && open.has(row.id) };
      });
    },

    /**
     * Publishes an offered icon under the game's own name only. The name it was offered under is the sender's free
     * text (a renamed game, or anything a client sends); as a match name it would hand this icon to other games.
     * A custom game has no other name: the reviewer sees it and approves the icon for exactly that name, as long
     * as no game in the dataset is called that.
     */
    approve(sha256: string): { ok: true; id: string } | { ok: false; error: string } {
      const row = state.pending(sha256);
      if (!row) return { ok: false, error: "No such offer." };
      if (store.list().some((entry) => entry.id === row.id) && !state.isReplaceable(row.id)) {
        return { ok: false, error: "That game already has an icon. Open it for replacements or take it down first." };
      }
      if (row.id.startsWith(LOCAL_PREFIX)) {
        if (gamesNamed(row.name).length > 0) return { ok: false, error: "A game in the dataset has this name now. Deny it; it can be offered for that game." };
        state.approve(sha256, [row.name], now());
        return { ok: true, id: row.id };
      }
      const canonical = gameName(row.id);
      if (canonical === null) return { ok: false, error: "That game is not in the dataset any more." };
      state.approve(sha256, [canonical], now());
      return { ok: true, id: row.id };
    },

    /** Drops an offer; blocking also refuses the same file for ever, and every later offer from the account that sent it. */
    deny(sha256: string, block: boolean): boolean {
      if (block) {
        const had = state.pending(sha256) !== null;
        const sender = state.pendingSender(sha256);
        state.block(sha256, "denied", now());
        if (sender !== null) state.blockSender(sender, now());
        return had;
      }
      return state.deletePending(sha256);
    },

    /** Opens a hosted icon for replacements, or closes it again. False for a game with no hosted icon. */
    setReplaceable(id: string, open: boolean): boolean {
      if (!store.list().some((icon) => icon.id === id)) return false;
      state.setReplaceable(id, open, now());
      return true;
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
