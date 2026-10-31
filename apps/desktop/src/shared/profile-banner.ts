/** The banners behind the picture in the profile dialog: patterns and scenes drawn in the theme's colours, or the
 * user's picture blurred. Kept on this PC only (library.profileBanner). */
export const PROFILE_BANNERS = ["stripes", "crosshatch", "sunburst", "dots", "checks", "rings", "night-camp", "forest", "mountains", "map", "picture"] as const;
export type ProfileBanner = (typeof PROFILE_BANNERS)[number];
export const isProfileBanner = (value: unknown): value is ProfileBanner => (PROFILE_BANNERS as readonly unknown[]).includes(value);
