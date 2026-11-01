/** Plain content that Tavora renders in a separate surface above the workspace. No HTML, CSS or links. */
export interface TooltipContent {
    title: string;
    subtitle?: string;
    /**
     * How the tooltip looks. `"neutral"` (the default) uses Tavora's own colours, whatever theme the user picked.
     * `"poe"` is the gold, brown and purple look of Path of Exile 2 item tooltips, with the rarity colours of `tone`
     * and the affix lines; ask for it only for items that look like that in the game.
     * Needs a Tavora that knows `look`: an older one rejects the whole tooltip, so be ready for `show` to fail (and
     * retry without `look`).
     */
    look?: "neutral" | "poe";
    /** The title's rarity colour; only the `"poe"` look has them. */
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
