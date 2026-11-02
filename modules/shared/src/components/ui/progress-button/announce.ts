export type ProgressButtonStatus = "idle" | "busy" | "done"

export interface Labels {
  busy: string
  done: string
  failed?: string
}

/**
 * What a screen reader is told when the status changes, once per change and never the percent: the busy label when work
 * starts, the done label when it worked, the failed label when it went back to idle without working. Empty otherwise
 * (the region is cleared, so the same words can be announced again next time).
 */
export function announcement(before: ProgressButtonStatus, now: ProgressButtonStatus, labels: Labels): string {
  if (now === before) return ""
  if (now === "busy") return labels.busy
  if (now === "done") return labels.done
  return before === "busy" ? (labels.failed ?? "") : ""
}
