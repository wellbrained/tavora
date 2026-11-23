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
     * `"unit"` is a game unit as games show it on the board: the picture (`image`) as a small framed portrait sticking out
     * at the top left, a title bar with the title and the `corner` value, and below it the `subtitle`, the `effect`, the
     * stats (label, value and `suffix`), the sections, the `icons` row and the `pips` on the bottom edge. It leaves out
     * `badges`, `requirements`, `perHeading`, `columns` and a stat's `per`, `more` and `icon`. It is at least 316 px
     * wide and grows to fit the stats and the icons, up to 520 px; the effect and the rows wrap. Needs
     * `sdk.supports("ui.tooltip.unit")`: on an older Tavora the SDK shows it in the `"card"` layout, without `corner`,
     * `icons` and `pips`, with each `suffix` after its value.
     */
    layout?: "rich" | "card" | "unit";
    /**
     * The unit layout's corner value, at the right of its title bar: a short text (up to 20 characters, e.g. "27" units)
     * and an optional pictogram after it (e.g. a person), given like a stat's `icon`: a bundle-relative PNG or WebP (up to
     * 64 KB; for the kit's `ItemCard`, a URL the page can load), drawn from its shape alone in the title's colour, 16 px
     * high, and left out when it can't be read. Only the unit layout shows it.
     */
    corner?: {
        text: string;
        icon?: string;
    };
    /**
     * The unit layout's row of small framed pictures under the stats (spells, buffs, items it carries), up to 12. Each
     * `image` is a bundle-relative PNG or WebP (up to 64 KB; for the kit's `ItemCard`, a URL the page can load), shown in
     * full colour, 38 × 34 px (cut to fill); `label` (up to 100 characters) is its name for screen readers; `count` (up to 8 characters,
     * e.g. "95") is a badge at its bottom right, in the card's text size. A picture that can't be read leaves an empty frame. Only the unit
     * layout shows it.
     */
    icons?: TooltipIcon[];
    /**
     * The unit layout's pips: `total` diamonds (1 to 10) centred on the bottom edge, the first `filled` of them filled
     * (0 to `total`, whole numbers), e.g. a level or stars. `extra` (up to 12 characters, e.g. "+67" for a level over the
     * most) is shown under them. Only the unit layout shows them.
     */
    pips?: {
        filled: number;
        total: number;
        extra?: string;
    };
    /**
     * The card's effect text, in a box of its own: one plain text, or runs of text where `accent: true` ones take the
     * accent colour (numbers, keywords). Up to 1,000 characters and 40 runs.
     */
    effect?: string | TooltipEffectRun[];
    /**
     * The name of a skin this module defined with `ui.tooltip.defineSkin`; only the `"card"` and `"unit"` layouts use
     * it. A name that isn't defined (yet) shows the plain card, without an error.
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
     * A row's `icon` is a small pictogram before its label (a heart for HP, a sword for damage), given like `image`: a
     * bundle-relative path to a PNG or WebP (dist/icons/heart.png, up to 64 KB; for the kit's `ItemCard`, a URL the page
     * can load). Only its shape counts: the card draws it in the label's colour, so give it a transparent background; it
     * is the label's height, and left out when it can't be read. Only the card layout shows it. Needs `sdk.supports("ui.tooltip.propertyIcon")`: on
     * an older Tavora the SDK leaves it out.
     * A row's `suffix` (up to 40 characters, kept as given, a leading space too) follows the value in the unit layout:
     * the values line up on their right edge and the suffix hangs past it in the accent colour, never wrapped, e.g.
     * "3.95" with "E+12", or "99.999" with " (MAX)". In the other layouts, and on a Tavora without
     * `sdk.supports("ui.tooltip.unit")`, the SDK puts it at the end of the value.
     * A row's `more` (up to 3 texts of up to 40 characters) are extra values after `value`, say the stat at level 2 and
     * 3: the card layout shows each in a column of its own, in the accent colour, with `columns` as headings; a row
     * with fewer leaves the rest empty, and an empty text leaves its cell empty. With `per` too, the order is label,
     * value, `more`, `per`. The rich layout shows them after the value ("6 · 12 · 18"). Needs
     * `sdk.supports("ui.tooltip.columns")`: on an older Tavora the SDK puts them into `per` ("12 / 18"), or into the
     * value where `per` isn't known either.
     */
    properties?: {
        label: string;
        value: string;
        per?: string;
        icon?: string;
        suffix?: string;
        more?: string[];
    }[];
    /** The heading over the `per` column ("Per level"), in the user's language, up to 60 characters; shown only with a `per`. */
    perHeading?: string;
    /**
     * Headings over the value column and then each `more` column (["Lv 1", "Lv 2", "Lv 3"]), in the user's language: up
     * to 4, each up to 20 characters, in the small style of `perHeading`. The heading row shows only with `columns`.
     * Only the card layout shows them. Needs `sdk.supports("ui.tooltip.columns")`: on an older Tavora the SDK makes the
     * headings after the first the `perHeading` ("Lv 2 / Lv 3"), or leaves them out where `per` isn't known either.
     */
    columns?: string[];
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
/** A picture in the unit layout's icon row. */
export interface TooltipIcon {
    image: string;
    /** Its name for screen readers ("Steel Coat"). */
    label: string;
    /** A badge at its bottom right, e.g. how many stacks ("95"). */
    count?: string;
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
 * type line, properties, sections and footer (the unit layout takes the skin's font everywhere but the footer), and
 * refuses a skin whose colours are hard to read. The unit layout takes `surface` for its body, `text` for its text and
 * lines, `muted`, `accent` for the values and the effect's accent runs, `bar`, the font and `pixelArt`.
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
        /**
         * A 2 px edge around the effect box; it needs a contrast of 3:1 with `box`. Left out, a skinned box has no edge.
         * Needs `sdk.supports("ui.tooltip.boxBorder")`: on an older Tavora the SDK leaves it out of `defineSkin`.
         */
        boxBorder?: string;
        /**
         * The unit layout's title bar; the title and the corner value (`text`) need a contrast of 4.5:1 with it. Left
         * out, the bar is `surface`. Needs `sdk.supports("ui.tooltip.unit")`: on an older Tavora the SDK leaves it out of
         * `defineSkin`.
         */
        bar?: string;
    };
    /**
     * A WOFF2 font (up to 512 KB) for the title and the effect box only (on the unit layout, for the whole card); letters
     * it lacks come from the theme font.
     */
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
    /**
     * The box of the element the card is for (CSS pixels in the panel, like `at`), which the SDK sends when you give an
     * `anchor`. Hover follows the pointer: without a box Tavora takes `show` and `move` only while the pointer is within
     * 40 px of `at`; with one, while it is over the box (plus 8 px). A box Tavora can't use (wider or taller than 600 px,
     * or not around `at`) falls back to the 40 px rule. Needs `sdk.supports("ui.tooltip.anchorBox")`: an older Tavora
     * rejects the unknown key, so the SDK leaves it out there.
     */
    box?: {
        x: number;
        y: number;
        width: number;
        height: number;
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
