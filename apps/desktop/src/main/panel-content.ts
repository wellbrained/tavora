import { LIMITS, type PanelContent } from "@tavora/sdk/protocol";

export type { PanelContent, PanelLaunch } from "@tavora/sdk/protocol";

/**
 * A panel's content as a module named it (panel.setContent), made safe to keep and to show on its tab:
 * the title on one line without control characters. Null when it is not a usable content.
 */
export function checkPanelContent(raw: unknown): PanelContent | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const { id, title } = raw as Record<string, unknown>;
  if (typeof id !== "string" || id.length === 0 || id.length > LIMITS.maxContentIdLength) return null;
  if (typeof title !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const line = title.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
  if (line.length === 0 || line.length > LIMITS.maxTitleLength) return null;
  return { id, title: line };
}
