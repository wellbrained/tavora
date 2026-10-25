// What the voice overlay shows, as the plain JSON Tavora keeps for it (overlay.publish, at most 16 KB). The overlay
// page has no bridge and no network, so pictures travel inside the state as tiny data addresses and the list is
// kept short. This turns the panel's members into that state; the page that draws it is overlay.ts.
import { initials } from "./ui";

export const OVERLAY_KEY = "voice";
/** Most people drawn; the rest are counted ("+3"). */
export const MAX_ROWS = 8;
/** Names are cut to this many characters on the overlay. */
export const MAX_OVERLAY_NAME = 24;
/** A little under Tavora's 16 KB limit, so the state always fits. */
export const MAX_STATE_BYTES = 15_000;

/** One row of the overlay. Flags are present (as 1) only when true, to save bytes. */
export interface OverlayPerson {
  /** Name; left out when names are off. */
  n?: string;
  /** Tiny picture as a data address; left out when there is none (a coloured circle with `i` is drawn). */
  a?: string;
  /** Initials for the circle, only without a picture. */
  i?: string;
  /** Colour of the circle, 0 to 5. */
  c: number;
  /** Talking. */
  s?: 1;
  /** Muted. */
  m?: 1;
  /** Deafened. */
  d?: 1;
}

export interface OverlayState {
  v: 1;
  names: boolean;
  people: OverlayPerson[];
  /** People in the channel beyond the ones drawn. */
  more: number;
}

/** The part of a panel member the overlay needs. */
export interface OverlayMember {
  id: string;
  name: string;
  /** Tiny picture (see avatar.ts) or null. */
  tiny: string | null;
  speaking: boolean;
  muted: boolean;
  deafened: boolean;
}

const COLOURS = 6;
const colour = (id: string) => (/^\d{1,20}$/.test(id) ? Number(BigInt(id) % BigInt(COLOURS)) : 0);
const encoder = new TextEncoder();
/** Size of a state as Tavora counts it. */
export const stateBytes = (state: OverlayState) => encoder.encode(JSON.stringify(state)).length;

/**
 * The state for the people in the player's channel. At most MAX_ROWS are drawn, in the channel's own order; when
 * there are more, the ones talking come first, then the others in order. If the state is still too big (many
 * pictures), the last rows lose their picture, then rows are dropped into "+N".
 */
export function buildOverlayState(members: readonly OverlayMember[], options: { names: boolean }): OverlayState {
  const chosen = members
    .map((member, index) => ({ member, index }))
    .sort((a, b) => Number(b.member.speaking) - Number(a.member.speaking) || a.index - b.index)
    .slice(0, MAX_ROWS)
    .sort((a, b) => a.index - b.index)
    .map(({ member }) => member);
  const people = chosen.map((member): OverlayPerson => {
    const person: OverlayPerson = { c: colour(member.id) };
    if (options.names) person.n = [...member.name].slice(0, MAX_OVERLAY_NAME).join("");
    if (member.tiny) person.a = member.tiny;
    else person.i = initials(member.name) || "?";
    if (member.speaking) person.s = 1;
    // Deafened people can't hear and so aren't heard either: one icon says it.
    if (member.deafened) person.d = 1;
    else if (member.muted) person.m = 1;
    return person;
  });
  const state: OverlayState = { v: 1, names: options.names, people, more: members.length - people.length };
  // Too big: pictures go from the bottom up first, then the rows themselves.
  for (let i = people.length - 1; i >= 0 && stateBytes(state) > MAX_STATE_BYTES; i--) {
    const person = people[i]!;
    if (person.a) {
      delete person.a;
      person.i = initials(chosen[i]!.name) || "?";
    }
  }
  while (people.length > 0 && stateBytes(state) > MAX_STATE_BYTES) {
    people.pop();
    state.more = members.length - people.length;
  }
  return state;
}
