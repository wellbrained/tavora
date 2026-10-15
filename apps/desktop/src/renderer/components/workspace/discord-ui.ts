import type { DiscordMember } from "../../../shared/host-api";

const COLOURS = ["#5865f2", "#3ba55d", "#faa61a", "#ed4245", "#eb459e", "#7289da"];

/** Discord's default pictures differ by colour; people without a picture get one of these with their initials. */
export function colourOf(member: DiscordMember): string {
  return COLOURS[Number(BigInt(member.id) % BigInt(COLOURS.length))]!;
}

export function initials(name: string): string {
  return [...name.trim()].slice(0, 2).join("").toUpperCase();
}
