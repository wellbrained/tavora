/** Plain content that Tavora renders in a separate surface above the workspace. No HTML, CSS or links. */
export interface TooltipContent {
    title: string;
    subtitle?: string;
    tone?: "normal" | "magic" | "rare" | "unique";
    /** Bundle-relative raster asset path, e.g. dist/assets/bow.webp. Never a web/file URL. */
    image?: string;
    badges?: string[];
    requirements?: {
        label: string;
        value: string;
    }[];
    properties?: {
        label: string;
        value: string;
    }[];
    sections?: {
        title?: string;
        rows: {
            text: string;
            badges?: string[];
            status?: string;
            connected?: boolean;
        }[];
    }[];
}
export interface TooltipAnchor {
    id: string;
    at: {
        x: number;
        y: number;
    };
}
export interface TooltipRequest extends TooltipAnchor {
    content: TooltipContent;
    pinned?: boolean;
}
