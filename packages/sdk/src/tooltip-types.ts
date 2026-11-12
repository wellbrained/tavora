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
    /**
     * How the card is laid out. `"rich"` (the default) is the tooltip as it always was: the picture beside the text.
     * `"card"` is an item card: the picture large on top, a name bar with the title, the subtitle as its type line,
     * the badges, the `effect` box, then properties and sections. Needs `sdk.supports("ui.tooltip.skin")`: on an older
     * Tavora the SDK leaves `layout` and `skin` out and puts `effect` into a section row, so the card shows in the rich
     * layout.
     */
    layout?: "rich" | "card";
    /**
     * The card's effect text, in a box of its own: one plain text, or runs of text where `accent: true` ones take the
     * accent colour (numbers, keywords). Up to 1,000 characters and 40 runs.
     */
    effect?: string | TooltipEffectRun[];
    /**
     * The name of a skin this module defined with `ui.tooltip.defineSkin`; only the `"card"` layout uses it. A name
     * that isn't defined (yet) shows the plain card, without an error.
     */
    skin?: string;
    badges?: string[];
    requirements?: {
        label: string;
        value: string;
    }[];
    /**
     * Stats as label and value. A row's `per` (e.g. "×1.2", up to 40 characters) is how much it grows, say per level: the
     * card layout shows it in a third column, in the accent colour, and the column appears only when a row of the card
     * has one; with `per`, `value` may be empty (a stat that only grows). The rich layout shows it after the value.
     * Needs `sdk.supports("ui.tooltip.per")`: on an older Tavora the SDK puts it into the value ("24 · ×1.2").
     */
    properties?: {
        label: string;
        value: string;
        per?: string;
    }[];
    /** The heading over the `per` column ("Per level"), in the user's language, up to 60 characters; shown only with a `per`. */
    perHeading?: string;
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
/** A run of the card's effect text. */
export interface TooltipEffectRun {
    text: string;
    /** Shown in the accent colour (the skin's, or the theme's primary). */
    accent?: boolean;
}
/**
 * A module's own look for its item cards (`ui.tooltip.defineSkin`): checked values, never CSS. Files are
 * bundle-relative paths in the module's own `dist/`, like `image`. Tavora sets every size, keeps the theme font for the
 * type line, properties, sections and footer, and refuses a skin whose colours are hard to read.
 */
export interface TooltipSkin {
    /**
     * A nine-slice frame around the card: a PNG or WebP picture (up to 512 KB) and its slice insets in pixels, top,
     * right, bottom, left (0 to 64 each), which are also the frame's width on the card.
     */
    frame?: {
        image: string;
        slice: [number, number, number, number];
    };
    /**
     * The card's colours as `#rrggbb`. They stay the same in every theme. With `colors`, `surface` and `text` are needed;
     * `muted` and `accent` default to `text`, `box` to `surface` and `boxText` to `text`. Text, muted text, the box's
     * text and the accent in the box need a contrast of 4.5:1 with what they sit on, the accent on the surface 3:1.
     */
    colors?: {
        surface?: string;
        text?: string;
        muted?: string;
        accent?: string;
        box?: string;
        boxText?: string;
    };
    /** A WOFF2 font (up to 512 KB) for the title and the effect box only; letters it lacks come from the theme font. */
    font?: string;
    /** Draws the picture and the frame with hard pixels instead of smoothing them (pixel art). */
    pixelArt?: boolean;
    /** Writes the title in capitals. */
    titleCaps?: boolean;
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
    /**
     * `false` says this card can't be pinned (a module whose cards are hover-only): the footer then leaves out "Click to
     * pin item details", and `pinned: true` together with it is refused (INVALID_PARAMS). Left out, the card shows the hint
     * as before. Needs Tavora 0.23.91 or newer: an older one rejects the unknown key, so the SDK leaves it out there
     * (`sdk.supports("ui.tooltip.pinnable")` tells) and the card shows with the old hint.
     */
    pinnable?: boolean;
}
