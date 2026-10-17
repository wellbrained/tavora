const COLOURS = ["#5865f2", "#3ba55d", "#faa61a", "#ed4245", "#eb459e", "#7289da"];

/** Discord's default pictures differ by colour; people without a picture get one of these with their initials. */
export function colourOf(id: string): string {
  return COLOURS[Number(BigInt(id) % BigInt(COLOURS.length))]!;
}

export function initials(name: string): string {
  return [...name.trim()].slice(0, 2).join("").toUpperCase();
}
