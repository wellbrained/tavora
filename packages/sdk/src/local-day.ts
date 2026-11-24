/** The local calendar day of a time, as YYYY-MM-DD: what a leaderboard result counts for without its own `day`. */
export function localDay(at: number): string {
  const date = new Date(at);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
