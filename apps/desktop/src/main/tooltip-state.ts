import type { TooltipRequest } from "@tavora/sdk/protocol";
import { usableBox } from "./tooltip-pointer";
export interface OpenTooltip {
    owner: string;
    request: TooltipRequest;
    serial: number;
}
/** Ownership and pin policy shared by every panel. A serial also guards asynchronous image loads. */
export class TooltipState {
    current: OpenTooltip | null = null;
    private serial = 0;
    show(owner: string, request: TooltipRequest): OpenTooltip | null {
        if (this.current?.request.pinned && !request.pinned)
            return null;
        return this.current = { owner, request, serial: ++this.serial };
    }
    move(owner: string, id: string, at: TooltipRequest["at"], box?: TooltipRequest["box"]): boolean {
        if (this.current?.owner !== owner || this.current.request.id !== id || this.current.request.pinned)
            return false;
        // The box goes with its point: a move without one keeps no box from before, which may be far from the new point.
        const { box: _old, ...request } = this.current.request;
        this.current.request = { ...request, at, ...(box ? { box } : {}) };
        return true;
    }
    close(owner?: string, id?: string, hoverOnly = false): OpenTooltip | null {
        const c = this.current;
        if (!c || (owner !== undefined && c.owner !== owner) || (id !== undefined && c.request.id !== id) || (hoverOnly && c.request.pinned))
            return null;
        this.current = null;
        return c;
    }
}
type Rect = { x: number; y: number; width: number; height: number };
/**
 * Where the card goes, in the window: beside the element it is for (`box`, when it is a usable one around `at`, or else
 * the point `at`), right first, then left. With no room on either side it goes below or above the element, so it never
 * lies on top of it: the pointer rests there, and a window appearing under it makes the panel see the pointer leave.
 */
export function tooltipBounds(at: { x: number; y: number }, size: { width: number; height: number }, area: Rect, box?: Rect) {
    const width = Math.min(size.width, Math.max(1, area.width - 16)), height = Math.min(size.height, Math.max(1, area.height - 16));
    const b = box && usableBox({ at, box }) ? box : { x: at.x, y: at.y, width: 0, height: 0 };
    const minX = area.x + 8, maxX = area.x + area.width - width - 8, minY = area.y + 8, maxY = area.y + area.height - height - 8;
    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));
    const right = b.x + b.width + 16, left = b.x - width - 16;
    let x = right, y = at.y - 24;
    if (right > maxX) {
        if (left >= minX) x = left;
        else {
            x = maxX - right >= left - minX ? right : left;
            const below = b.y + b.height + 8, above = b.y - height - 8;
            if (below <= maxY) y = below;
            else if (above >= minY) y = above;
        }
    }
    return { x: Math.round(clamp(x, minX, maxX)), y: Math.round(clamp(y, minY, maxY)), width: Math.ceil(width), height: Math.ceil(height) };
}
