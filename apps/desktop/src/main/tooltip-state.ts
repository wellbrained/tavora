import type { TooltipRequest } from "@tavora/sdk/protocol";
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
    move(owner: string, id: string, at: TooltipRequest["at"]): boolean {
        if (this.current?.owner !== owner || this.current.request.id !== id || this.current.request.pinned)
            return false;
        this.current.request = { ...this.current.request, at };
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
export function tooltipBounds(at: {
    x: number;
    y: number;
}, size: {
    width: number;
    height: number;
}, area: {
    x: number;
    y: number;
    width: number;
    height: number;
}) {
    const width = Math.min(size.width, Math.max(1, area.width - 16)), height = Math.min(size.height, Math.max(1, area.height - 16));
    const right = at.x + 16, left = at.x - width - 16;
    const x = right + width <= area.x + area.width - 8 ? right : left;
    return { x: Math.round(Math.max(area.x + 8, Math.min(x, area.x + area.width - width - 8))), y: Math.round(Math.max(area.y + 8, Math.min(at.y - 24, area.y + area.height - height - 8))), width: Math.ceil(width), height: Math.ceil(height) };
}
