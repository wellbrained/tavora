export function bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

export const when = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleString() : "Unknown");
export const date = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleDateString() : "Unknown");

/** "3 hours ago", for the things that should be recent. */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "Unknown";
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 2) return "just now";
  if (minutes < 120) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hours ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export const plural = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`;

/** The five reasons for Decline and Ban, as the developer's email names them. */
export const REASONS = { unsafe: "Unsafe or harmful", hateful: "Hateful content", adult: "Adult content", spam: "Spam or copy", broken: "Doesn't work" } as const;
export const reasonLabel = (reason: string): string => REASONS[reason as keyof typeof REASONS] ?? reason;
