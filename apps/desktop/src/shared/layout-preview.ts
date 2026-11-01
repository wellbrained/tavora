// "Preview as" on the Overlay page: the shapes the canvas can be shown in. It is a preview only; saved positions are
// anchored to edges (overlay-anchor.ts), so a shape here never changes them, it shows how they play out on that shape.

/** The shape the setup really has: the game's window, or the main screen. */
export const PREVIEW_DEFAULT = "default";
/** A connected monitor's choice is this and its id. */
export const PREVIEW_MONITOR = "monitor:";

/** The fixed shapes of the picker. */
export const PREVIEW_RATIOS = [
  { id: "16:9", aspect: 16 / 9 },
  { id: "16:10", aspect: 16 / 10 },
  { id: "21:9", aspect: 21 / 9 },
  { id: "32:9", aspect: 32 / 9 },
] as const;

/** A connected monitor, in its own pixels. */
export interface Monitor {
  id: number;
  width: number;
  height: number;
}

const NAMED: readonly [number, number][] = [
  [1, 1],
  [5, 4],
  [4, 3],
  [3, 2],
  [16, 10],
  [16, 9],
  [21, 9],
  [32, 9],
  [9, 16],
];

/** A shape's name: "16:9" for the usual ones (a hair off counts, like 3440x1440 for 21:9), else "2.40:1". */
export function ratioLabel(width: number, height: number): string {
  const aspect = width / height;
  if (!Number.isFinite(aspect) || aspect <= 0) return "16:9";
  const near = NAMED.find(([w, h]) => Math.abs(aspect / (w / h) - 1) < 0.03);
  return near ? `${near[0]}:${near[1]}` : `${aspect.toFixed(2)}:1`;
}

/** The monitor a choice names, or undefined. */
export function monitorOf(choice: string, monitors: readonly Monitor[]): Monitor | undefined {
  if (!choice.startsWith(PREVIEW_MONITOR)) return undefined;
  const id = Number(choice.slice(PREVIEW_MONITOR.length));
  return monitors.find((monitor) => monitor.id === id);
}

/** The width over height a choice shows the canvas in; null for the default or a choice that is gone (a monitor unplugged). */
export function previewAspect(choice: string, monitors: readonly Monitor[]): number | null {
  const ratio = PREVIEW_RATIOS.find((item) => item.id === choice);
  if (ratio) return ratio.aspect;
  const monitor = monitorOf(choice, monitors);
  return monitor && monitor.width > 0 && monitor.height > 0 ? monitor.width / monitor.height : null;
}
