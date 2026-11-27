// Wire protocol v1 between a module and the Tavora host, carried over a
// MessagePort. Specified in apps/docs/reference/protocol.md.
//
// Identity (which module, which workspace, which panel) is never part of a
// message. The host binds it to the port when it creates the channel.

/** Major protocol version. Every message carries it as `v`. */
export const PROTOCOL_VERSION = 1;

/** Posted by the SDK on its own window to ask the host for a bridge port. */
export const HELLO_MESSAGE = "tavora:hello";
/** Posted by the host preload on the module window, carrying the port. */
export const PORT_MESSAGE = "tavora:port";

/** The workspace a panel is in: an item on Tavora's rail. */
export interface TavoraWorkspace {
  id: string;
  displayName: string;
  /**
   * `"game"`: a game workspace, linked to a game; its id is the game's id, the one a manifest's `games` lists.
   * `"personal"`: a personal workspace the user made for modules that belong to no game, such as notes.
   */
  kind: "game" | "personal";
}

export interface TavoraViewport {
  width: number;
  height: number;
}

export interface TavoraTheme {
  mode: "dark" | "light";
  /** A short summary of the palette, for modules that only need a few colours. */
  colors: {
    background: string;
    surface: string;
    text: string;
    textMuted: string;
    accent: string;
  };
  /**
   * The full semantic palette as CSS colours, named like the CSS variables
   * of shadcn-vue plus Tavora's extras (see THEME_TOKENS). Set each one as
   * `--<name>` to match the host UI.
   */
  tokens: Record<ThemeToken, string>;
  /** Corner radius for buttons, inputs and cards, in CSS pixels. */
  radius: number;
  /** Where the user wants toasts in a panel. Older Tavora leaves it out, which means bottom center. */
  toasts?: ToastPosition;
  /**
   * The interface font the user picked (Settings > Appearance). It can change while the module is open, like the colours.
   * Older Tavora leaves it out, which means Inter.
   */
  font?: ThemeFont;
  /**
   * The design style the user picked (Settings > Appearance): one look per part of the kit and a few sizes. Colours stay
   * in the theme, and `radius` and `font` above already hold the style's corner and font (or the user's own). It can
   * change while the module is open, like the colours. Older Tavora (before `STYLE_TAVORA`) leaves it out, which means
   * Classic (`CLASSIC_STYLE`). `applyHostTheme` writes it to the page.
   */
  style?: TavoraStyle;
  /**
   * How the user reaches tabs that don't fit a row (Settings > Appearance > Too many tabs): a list button or arrows. The
   * kit's `TabStrip` follows it, like Tavora's own panel tabs. It can change while the module is open, like the colours.
   * Older Tavora (before `TAB_OVERFLOW_TAVORA`) leaves it out, which means `"list"`; read it with `tabOverflowOf`.
   */
  tabOverflow?: TabOverflow;
}

/** How tabs that don't fit a row are reached (`TavoraTheme.tabOverflow`): a list of them, or arrows that step through them. */
export type TabOverflow = "list" | "arrows";
export const TAB_OVERFLOWS = ["list", "arrows"] as const satisfies readonly TabOverflow[];

/** What a theme says about tabs that don't fit: its `tabOverflow`, or `"list"` when it has none or one this SDK doesn't know. */
export function tabOverflowOf(theme: Pick<TavoraTheme, "tabOverflow"> | undefined | null): TabOverflow {
  const value = theme?.tabOverflow;
  return (TAB_OVERFLOWS as readonly unknown[]).includes(value) ? (value as TabOverflow) : "list";
}

/**
 * The parts of the kit a style draws, and the looks each can take. A style picks one look per part. Tavora may add looks
 * and parts: treat one you don't know like the first of its list.
 */
export const STYLE_LOOKS = {
  /** App background, rail, top bar and panel; menus, popovers and dialogs follow it. */
  surface: ["flat", "raised", "glass"],
  /** The tab strip of a panel. */
  tabs: ["pill", "keycap"],
  /** A panel's content area: as it is, or set in like a screen. */
  content: ["plain", "inset"],
  buttons: ["soft", "keycap", "capsule"],
  /** Inputs, checkboxes and switches. */
  inputs: ["soft", "inset", "capsule"],
  /** Lists and the selected row. */
  lists: ["fill", "inverted"],
  /** Labels and small headings: as they are, or small caps in the mono font. */
  labels: ["normal", "caps-mono"],
  /** A status light next to things that run. */
  status: ["none", "led"],
} as const;

/** A part of the kit a style picks a look for. */
export type StylePart = keyof typeof STYLE_LOOKS;
/** The parts in their fixed order. */
export const STYLE_PARTS = Object.keys(STYLE_LOOKS) as StylePart[];
/** One look per part. */
export type StyleLooks = { [P in StylePart]: (typeof STYLE_LOOKS)[P][number] };

/** The sizes a style sets. Tavora keeps each in its range (`STYLE_RANGES`). */
export interface StyleValues {
  /** Border width in px, 0–2. */
  borderWidth: number;
  /** Depth from 0 (none) to 3 (strong); the kit turns it into shadows for each look. */
  depth: number;
  /** The size of control and interface text in px, 12–15 (13 in Classic); the kit scales its type from it. */
  textSize: number;
  /** Control height in px, 28–40. */
  controlHeight: number;
  /** A factor on spacing, 0.85–1.2. */
  spacing: number;
  /** How opaque glass surfaces are, 0.55–0.95; only the glass look uses it. */
  glassOpacity: number;
}

/** The range each style value is kept in. */
export const STYLE_RANGES = {
  borderWidth: { min: 0, max: 2 },
  depth: { min: 0, max: 3 },
  textSize: { min: 12, max: 15 },
  controlHeight: { min: 28, max: 40 },
  spacing: { min: 0.85, max: 1.2 },
  glassOpacity: { min: 0.55, max: 0.95 },
} as const satisfies Record<keyof StyleValues, { min: number; max: number }>;

/** The CSS variable `applyHostTheme` writes each style value to, and its unit. */
export const STYLE_VARIABLES = {
  borderWidth: { name: "--style-border-width", unit: "px" },
  depth: { name: "--style-depth", unit: "" },
  textSize: { name: "--style-text", unit: "px" },
  controlHeight: { name: "--style-control-height", unit: "px" },
  spacing: { name: "--style-space", unit: "" },
  glassOpacity: { name: "--style-glass-opacity", unit: "" },
} as const satisfies Record<keyof StyleValues, { name: `--style-${string}`; unit: "" | "px" }>;

/** A design style as a panel gets it in `TavoraTheme.style`. */
export interface TavoraStyle {
  /** Such as `"tavora.classic"`. Tavora may add styles, so treat an id you don't know like any other. */
  id: string;
  /** Its name, the same in every language. */
  name: string;
  looks: StyleLooks;
  values: StyleValues;
}

/** A look or style id as it may go into an attribute: lower-case letters, digits, dots and hyphens. */
const STYLE_WORD = /^[a-z0-9][a-z0-9.-]{0,63}$/;

/**
 * What a style puts on a page's root element, `null` for what goes away: `data-style`, `data-look-<part>` for every part
 * and the `--style-*` variables (`STYLE_VARIABLES`). Without a style everything goes, so CSS defaults (Classic) show; so
 * does a look or value that can't be used. `applyHostTheme` writes it; Tavora's own page uses the same.
 */
export function styleMarks(style: TavoraStyle | undefined): { attributes: [name: string, value: string | null][]; properties: [name: string, value: string | null][] } {
  const word = (value: unknown) => (typeof value === "string" && STYLE_WORD.test(value) ? value : null);
  const attributes: [string, string | null][] = [["data-style", word(style?.id)]];
  for (const part of STYLE_PARTS) attributes.push([`data-look-${part}`, word(style?.looks?.[part])]);
  const properties = (Object.entries(STYLE_VARIABLES) as [keyof StyleValues, { name: string; unit: string }][]).map(([key, { name, unit }]): [string, string | null] => {
    const value = style?.values?.[key];
    return [name, typeof value === "number" && Number.isFinite(value) ? `${value}${unit}` : null];
  });
  return { attributes, properties };
}

/** Tavora's look before styles came, and what a theme without `style` means. */
export const CLASSIC_STYLE: TavoraStyle = {
  id: "tavora.classic",
  name: "Classic",
  looks: { surface: "flat", tabs: "pill", content: "plain", buttons: "soft", inputs: "soft", lists: "fill", labels: "normal", status: "none" },
  values: { borderWidth: 1, depth: 1, textSize: 13, controlHeight: 32, spacing: 1, glassOpacity: 0.8 },
};

/** The interface font in a TavoraTheme. */
export interface ThemeFont {
  /** Which font it is, such as `"inter"`. Tavora may add fonts, so treat an id you don't know like any other. */
  id: string;
  /** The CSS `font-family` value to use, such as `"Inter Variable", system-ui, sans-serif`. Tavora's page already has its files. */
  family: string;
}

/** Tavora's default interface font, and what a theme without `font` means. */
export const DEFAULT_THEME_FONT: ThemeFont = { id: "inter", family: '"Inter Variable", system-ui, sans-serif' };

/** Where toasts show in a panel (Settings > Appearance > Notifications). */
export type ToastPosition = "bottom-center" | "bottom-right" | "top-center";
export const TOAST_POSITIONS = ["bottom-center", "bottom-right", "top-center"] as const satisfies readonly ToastPosition[];

/** Names of the semantic colour tokens in TavoraTheme.tokens. */
export const THEME_TOKENS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-hover",
  "primary-foreground",
  "primary-fill",
  "primary-fill-hover",
  "primary-fill-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "border",
  "input",
  "ring",
  "rail",
  "success",
  "warning",
  "info",
  "toast",
  "toast-foreground",
] as const;

export type ThemeToken = (typeof THEME_TOKENS)[number];

/**
 * Tokens a theme may leave out, with the token each one copies then. Toasts
 * are flipped pills by default: the theme's text colour as the background,
 * the theme's background as the text. Tavora fills these in, so a module
 * always gets every token.
 *
 * The `primary-fill` trio colours solid surfaces that carry text, the Primary button first: a theme can
 * have a deep button with light text while `primary` stays bright for links, highlights and lines.
 * Left out, each copies `primary`, `primary-hover` and `primary-foreground`, so the look is the same as before.
 */
export const OPTIONAL_THEME_TOKENS = {
  "primary-fill": "primary",
  "primary-fill-hover": "primary-hover",
  "primary-fill-foreground": "primary-foreground",
  toast: "foreground",
  "toast-foreground": "background",
} as const satisfies Partial<Record<ThemeToken, ThemeToken>>;

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface HandshakeResult {
  protocol: typeof PROTOCOL_VERSION;
  host: { name: "tavora-desktop"; version: string };
  module: { id: string; version: string };
  /** Capabilities this module has been granted. */
  capabilities: Capability[];
  /**
   * The panel this page runs in: its panel type, one of the manifest's `panels` ids, or null for a module
   * without panel types. Tavora 0.17.12 and newer send it.
   */
  panel?: { type: string | null };
}

/**
 * What a panel shows, as the module names it: a build, a character, a run, a document. Tavora keeps it
 * with the panel and shows the title when the user hovers the panel's tab.
 */
export interface PanelContent {
  /** The module's own id for it, at most 200 characters. */
  id: string;
  /** Its full name, at most 200 characters on one line. */
  title: string;
}

/**
 * Why this page of the panel is loading.
 * - `add`: the user just added the panel. Pick the content yourself, such as the last one used, or show a picker.
 * - `restore`: the panel was open before (a restart, a switch back to its workspace, a reload). `content` is what it last
 *   showed through `panel.setContent`, or null.
 * - `open`: another panel of this module opened it with `panels.open`. Show `content`, or pick yourself when it is null.
 */
export type PanelLaunch =
  | { reason: "add" }
  | { reason: "restore"; content: PanelContent | null }
  | { reason: "open"; content: PanelContent | null };

/**
 * What `panels.open` did.
 * - `shown`: a panel of that type already showed the content (or none was asked for), and Tavora brought it to the front.
 * - `switched`: an open panel of that type switched to the content (its `panel.onNavigate` handler succeeded).
 * - `opened`: Tavora opened a new panel of that type.
 * - `failed`: the panel that should switch could not save or did not answer in time. It keeps what it showed, and
 *   Tavora offers the user to open the content in a new panel.
 */
export type PanelOpenResult = "shown" | "switched" | "opened" | "failed";

/**
 * What `panels.openMany` did with one panel type.
 * - `opened`: Tavora opened a new panel of that type, placed by the manifest's `panelLayout` when it has one.
 * - `shown`: a panel of that type was open in the workspace already (the one that asked, too); it came to the front where it is.
 * - `failed`: no panel could open, such as when the workspace is full.
 */
export type PanelOpenManyResult = "opened" | "shown" | "failed";

/** Tavora asks this panel to show other content (the `panel.navigate` event); answer with `panel.navigated`. */
export interface PanelNavigateRequest {
  requestId: number;
  content: PanelContent;
}

export interface DocumentSummary {
  id: string;
  title: string;
  revision: number;
  updatedAt: string;
  bytes: number;
}

export interface TavoraDocument extends DocumentSummary {
  data: JsonValue;
}

export interface PutDocumentParams {
  /** Omit to create a new document with a host-generated id. */
  id?: string;
  title: string;
  data: JsonValue;
  /** Reject with CONFLICT unless the stored revision still matches. */
  ifRevision?: number;
}

/**
 * A web request the host makes for the module (network.fetch). Only to a host the module names in
 * `permissions.network` and the user granted, only over HTTPS; the host sends no cookies and
 * follows redirects only to granted hosts.
 */
export interface NetworkRequest {
  url: string;
  /** Default GET. */
  method?: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Cookie, Host, Origin, Referer, Proxy-*, Sec-* and the transfer headers are set by the host and refused here. */
  headers?: Record<string, string>;
  /** Text only; send binary data as base64 or JSON. */
  body?: string;
  /** "base64" for pictures and other binary answers. Default "text" (read as UTF-8). */
  responseType?: "text" | "base64";
}

export interface NetworkResponse {
  status: number;
  /** The address that answered, after any redirects. */
  url: string;
  /** Lowercase names; Set-Cookie is left out. */
  headers: Record<string, string>;
  /** The answer as text, or base64 when the request asked for it. */
  body: string;
}

/** A public page rendered in a new, hidden, isolated browser session. */
export interface PageResponse { url: string; status: number; title: string; html: string }

/** An AI account the user set up in Settings > Integrations > AI usage, as the ai-usage connector shows it. */
export interface AiUsageAccountInfo {
  /** Chosen by Tavora; stays the same while the account exists. */
  id: string;
  provider: "claude" | "codex";
  /** The user's name for it. */
  label: string;
  /** The subscription plan from the profile's saved login, from a fixed list of names (Pro, Max 5×, Plus, ...), or null. */
  plan: string | null;
}

/**
 * One reading of an account's usage through the ai-usage connector. Tavora reads the login itself
 * and hands over only the provider's answer, never the token. An account is read at most once a
 * minute (LIMITS.aiUsageMinReadMs); asking sooner gives the last reading again.
 */
export interface AiUsageReading {
  /**
   * ok: `answer` holds the provider's answer. sign-in: the profile has no usable subscription login.
   * rate-limited: the provider asked to wait (`retryAfterMs`). api-key: the login is an API key,
   * which has no subscription allowance. cli-missing: the Codex command line is not installed.
   * unavailable: anything else.
   */
  status: "ok" | "sign-in" | "rate-limited" | "api-key" | "cli-missing" | "unavailable";
  /** For rate-limited: how long to wait at least, in milliseconds; otherwise null. */
  retryAfterMs: number | null;
  /**
   * The provider's answer as it came, for status ok: Claude's usage answer (undocumented, may change)
   * or the Codex app-server's `account/rateLimits/read` result. Null otherwise.
   */
  answer: JsonValue | null;
  /** The signed-in email the provider reports, or null. */
  email: string | null;
  plan: string | null;
  /** When Tavora took this reading (ISO 8601). */
  readAt: string;
}

/** Kinds of drive the system-info connector tells apart. */
export type SystemDriveKind = "internal" | "removable" | "network" | "other";

/**
 * What this PC is, through the system-info connector: names and sizes only, never a path or a serial number.
 * Read once and kept; asked again after a `systemInfo.drivesChanged` event, the only part that can change.
 */
export interface SystemInfo {
  cpu: {
    /** The processor's name as Windows gives it, such as "AMD Ryzen 9 5900X 12-Core Processor". */
    model: string;
    /** Logical processors (threads). */
    threads: number;
  };
  /** Installed memory in bytes. */
  ramBytes: number;
  /** The graphics cards, without software adapters such as Microsoft Basic Render Driver. */
  gpus: {
    /** The adapter's LUID as text, such as "0x00000000_0x0001defc"; the same `id` as in snapshots. */
    id: string;
    name: string;
    /** Has its own video memory (512 MB or more), as opposed to sharing the PC's memory. */
    dedicated: boolean;
    /** Its own video memory in bytes, or null when it has none. */
    vramBytes: number | null;
  }[];
  /** The drives with a letter now: hard drives, USB sticks, network drives. No CD or DVD drives. */
  drives: {
    /** The drive letter with a colon, such as "C:". */
    id: string;
    /** The drive's name ("Games"), or an empty text when it has none or Tavora doesn't ask. */
    label: string;
    kind: SystemDriveKind;
    /** Size in bytes, or null when unknown. Always null for network drives, which Tavora doesn't wait for. */
    totalBytes: number | null;
  }[];
}

/** The parts of this PC a panel can watch (systemInfo.watch). Leave a part out or false to not watch it. */
export interface SystemWatchBlocks {
  cpu?: boolean;
  gpu?: boolean;
  ram?: boolean;
  /** Drive letters with a colon ("C:"), at most 26. */
  drives?: string[];
  /** The internet connection: pings, packet loss and speed (SystemConnection). Tavora 0.21.22 and newer. */
  connection?: boolean;
  /** Tavora's own CPU and memory use. */
  tavora?: boolean;
}

/** How often a snapshot comes (SYSTEM_INTERVALS_MS). */
export type SystemInterval = 1000 | 2000 | 5000 | 15000 | 60000;

/** The intervals systemInfo.watch accepts, in milliseconds. */
export const SYSTEM_INTERVALS_MS: readonly SystemInterval[] = [1000, 2000, 5000, 15000, 60000];

/** The most drives one panel can watch at once. */
export const SYSTEM_MAX_DRIVES = 26;

/**
 * How busy this PC is, as the system-info connector reports it. Only the parts the panel asked for in
 * systemInfo.watch are there. Percentages run from 0 to 100 with one decimal.
 */
export interface SystemSnapshot {
  /** When it was taken (milliseconds since 1970). */
  at: number;
  /** The interval it was asked for. */
  intervalMs: number;
  cpu?: {
    /** The average since the last snapshot, as Task Manager shows it. */
    usage: number;
    /** The busiest second since the last snapshot. The same as `usage` for intervals under 5 seconds. */
    peak: number;
    /** The average of each logical processor, in order. */
    cores: number[];
  };
  gpus?: {
    /** The `id` from SystemInfo.gpus. */
    id: string;
    usage: number;
    peak: number;
    /** Video memory in use in bytes, or null when Windows doesn't say. */
    vramUsedBytes: number | null;
    /**
     * Temperature of the graphics chip in whole degrees Celsius. Only NVIDIA cards report it (Tavora 0.21.8 and
     * newer); null for other cards or when the card doesn't say. Missing on older Tavora.
     */
    temperatureC?: number | null;
    /** Graphics clock in whole MHz; the same cards and rules as `temperatureC`. */
    clockMhz?: number | null;
    /** Power the card draws in watts, with one decimal; the same cards and rules as `temperatureC`. */
    powerW?: number | null;
  }[];
  ram?: { usedBytes: number; totalBytes: number };
  drives?: {
    /** One entry for each drive asked for, in that order. */
    id: string;
    /** False when the drive letter is gone, such as an unplugged USB stick; the rest is then null or 0. */
    connected: boolean;
    freeBytes: number | null;
    totalBytes: number | null;
    readBytesPerSec: number;
    writeBytesPerSec: number;
  }[];
  /** Tavora's own use: `cpu` as a share of the whole PC, `memoryBytes` in working set. */
  tavora?: { cpu: number; memoryBytes: number };
  /** The connection as of its last check (every 5 seconds), when the panel asked for it. Tavora 0.21.22 and newer. */
  connection?: SystemConnection;
}

/** One app running on this PC: its processes taken together under one name (systemInfo.apps). */
export interface SystemApp {
  /** The program's file name without ".exe" and with a capital first letter ("Firefox"), or Windows' own name ("Memory Compression"). */
  name: string;
  /** Memory only this app uses (private working set), as Task Manager's Memory column. */
  memoryBytes: number;
  /** CPU since the last reading as a share of the whole PC, with one decimal; null before there are two readings. */
  cpu: number | null;
  /** One of Windows' own processes, such as svchost or Memory Compression. */
  windows: boolean;
}

/** The apps running now, the biggest first, and how much memory the PC uses in all (systemInfo.apps). */
export interface SystemApps {
  apps: SystemApp[];
  usedBytes: number;
}

/**
 * What this PC received and sent in one period, as Windows counts it for Settings > Network > Data usage, over every
 * network but VPNs (systemInfo.traffic). Windows keeps its record for 60 days; a month before that is known only when
 * Tavora read it in time.
 */
export interface SystemTrafficPeriod {
  /** When the period starts (local midnight), in milliseconds since 1970. */
  start: number;
  /** When it ends: now for the period still running. */
  end: number;
  /** Bytes received and sent; null when there is no record of the period. */
  downBytes: number | null;
  upBytes: number | null;
  /** Where the record of the period begins: `start`, a later time when the record begins inside it, or null for none. */
  countedFrom: number | null;
}

/** This week (from Monday) and this month with the 3 months before it, newest first (systemInfo.traffic). */
export interface SystemTraffic {
  week: SystemTrafficPeriod;
  months: SystemTrafficPeriod[];
}

/** What a media session is doing, as the user reports it to Windows. */
export type MediaStatus = "playing" | "paused" | "stopped" | "changing" | "closed";

/** What media.control can ask a user to do. */
export type MediaAction = "playPause" | "next" | "previous";

/** The actions media.control takes. */
export const MEDIA_ACTIONS: readonly MediaAction[] = ["playPause", "next", "previous"];

/**
 * One app that plays something, as Windows' media controls (the volume flyout) show it: Spotify, a browser tab,
 * a video player. Texts are as the app gives them and may be empty.
 */
export interface MediaSession {
  /** Stays the same while the session lasts; pass it to media.control. */
  id: string;
  /** The app: `id` as Windows names it (such as "Spotify.exe"), `name` a readable name (such as "Spotify"). */
  app: { id: string; name: string };
  /** The session Windows' media keys work on now. At most one is. */
  current: boolean;
  title: string;
  artist: string;
  album: string;
  status: MediaStatus;
  /**
   * Where the song was at `positionAt` (milliseconds since 1970), in milliseconds. While playing it runs on from
   * there, so count forward yourself; a new `media.changed` comes when it jumps. Null when the app doesn't say.
   */
  positionMs: number | null;
  positionAt: number | null;
  /** The song's length in milliseconds, or null when the app doesn't say. */
  durationMs: number | null;
  /** The cover as a JPEG data URL, at most 300 px on each side, or null when there is none. */
  cover: string | null;
  /** Which actions the app takes now. */
  can: Record<MediaAction, boolean>;
}

/**
 * The media connector's view of this PC. `ready`: `sessions` is what plays now (it may be empty). `starting`:
 * Tavora is still looking. `unavailable`: this PC can't tell (not Windows, or this Tavora was built without it).
 * `failed`: Tavora couldn't read it and stopped trying until a panel starts watching again.
 */
export interface MediaState {
  state: "starting" | "ready" | "unavailable" | "failed";
  sessions: MediaSession[];
}

/**
 * What kind of trouble a drop of the connection was.
 * offline: Windows says there is no network. no-router: the router stopped answering (3 pings in a row) and the
 * internet is down too. no-internet: 3 pings in a row to the internet address were lost, and the router answers, is
 * not found or never answers pings.
 */
export type SystemOutageKind = "offline" | "no-router" | "no-internet";

/**
 * How the internet connection is doing, as the system-info connector watches it. Tavora pings the router and one
 * address on the internet every 5 seconds while a System Monitor panel exists in any workspace, whether
 * or not it is shown, so drops are logged. Nothing but those pings is sent.
 */
export interface SystemConnection {
  /**
   * online: all is well. offline, no-router and no-internet: a drop is going on (SystemOutageKind; a drop keeps the worst
   * kind it had). off: the
   * watcher is switched off (SystemConnectionSettings.enabled) or not running, so there are no readings.
   */
  state: "online" | SystemOutageKind | "off";
  /** The last ping to the router in milliseconds, or null when it was lost or no router was found. */
  routerMs: number | null;
  /** The last ping to `target` in milliseconds, or null when it was lost. */
  internetMs: number | null;
  /** False when Tavora found no router (no network adapter with a gateway). */
  routerFound: boolean;
  /** Pings lost out of the last 100 to the router or to `target`, whichever is worse; 0 to 100 with one decimal. */
  lossPercent: number;
  /** Speed of the network adapter in use in megabits per second since the last check (not a speed test), or null before the second check. */
  downMbit: number | null;
  upMbit: number | null;
  /** What is pinged on the internet: an IP address or a name. */
  target: string;
  /** When the current drop began (milliseconds since 1970), or null while online. */
  since: number | null;
}

/** One drop of the connection in the log. */
export interface SystemOutage {
  /** When it began (milliseconds since 1970). */
  start: number;
  /** When it ended, or null while it goes on. */
  end: number | null;
  kind: SystemOutageKind;
  /** How long it lasted (so far, if it goes on), in milliseconds. */
  durationMs: number;
}

/** The drops of the last 30 days on this PC, the newest first. */
export interface SystemConnectionLog {
  outages: SystemOutage[];
}

/** What the user chose for the watcher. It is the same for every panel and module on this PC. */
export interface SystemConnectionSettings {
  /** Whether Tavora watches the connection at all. */
  enabled: boolean;
  /** An IP address or a name, such as "1.1.1.1" or "example.com". */
  target: string;
}

/** The address pinged unless the user picks another. */
export const SYSTEM_PING_TARGET = "1.1.1.1";

/**
 * The discord connector's connection to the Discord app on this PC, with Tavora's Discord sign-in.
 * The connection runs while a panel of a module granted the connector has asked for it.
 */
export interface DiscordState {
  /**
   * connecting: looking for the Discord app and signing in. not-running: no Discord app was found;
   * Tavora keeps looking. signed-out: Tavora was never approved in Discord, or the user signed out;
   * connect() asks. approving: Discord shows its approval pop-up. connected: commands and events work.
   * error: the last sign-in failed (see `error`); connect() tries again.
   */
  status: "connecting" | "not-running" | "signed-out" | "approving" | "connected" | "error";
  /**
   * For error: not-approved (the user declined in Discord), no-code (Discord gave no sign-in code),
   * offline (discord.com could not be reached), no-sign-in (discord.com refused the sign-in), failed.
   */
  error: "not-approved" | "no-code" | "offline" | "no-sign-in" | "failed" | null;
  /** Who Tavora is signed in to Discord as, once connected. Names come from Discord; show them as text only. */
  user: { id: string; name: string } | null;
  /** The sign-in may mute and deafen the user (SET_VOICE_SETTINGS). Sign-ins made before Tavora 0.5.11 can't until allowControl(). */
  canControl: boolean;
  /** False where this PC can't keep the sign-in safely, so it lasts only until Tavora closes. */
  canSaveSignIn: boolean;
}

/**
 * The Discord RPC commands a module may send through the discord connector, and their arguments.
 * Tavora checks every argument and sends exactly these fields; Discord's answer comes back as it came.
 */
export interface DiscordCommands {
  /** The voice channel the user is in, with its `voice_states`, or null. */
  GET_SELECTED_VOICE_CHANNEL: Record<string, never>;
  /** The servers the user is on. */
  GET_GUILDS: Record<string, never>;
  GET_GUILD: { guild_id: string };
  /** A server's channels (ids, names and types; voice channels are type 2, stage channels 13). */
  GET_CHANNELS: { guild_id: string };
  /** One channel, with who is in it when it is a voice channel. */
  GET_CHANNEL: { channel_id: string };
  /** Joins a voice channel (an id) or leaves (null). Only right after a click or key press in the panel, one per click. */
  SELECT_VOICE_CHANNEL: { channel_id: string | null };
  /** Mutes or deafens the user. Needs DiscordState.canControl. */
  SET_VOICE_SETTINGS: { mute?: boolean; deaf?: boolean };
  /** How loud someone is for the user (0 to 200) and/or muted for the user only: Discord's own per-person settings. */
  SET_USER_VOICE_SETTINGS: { user_id: string; volume?: number; mute?: boolean };
}

export type DiscordCommand = keyof DiscordCommands;
export const DISCORD_COMMANDS = [
  "GET_SELECTED_VOICE_CHANNEL",
  "GET_GUILDS",
  "GET_GUILD",
  "GET_CHANNELS",
  "GET_CHANNEL",
  "SELECT_VOICE_CHANNEL",
  "SET_VOICE_SETTINGS",
  "SET_USER_VOICE_SETTINGS",
] as const satisfies readonly DiscordCommand[];

/**
 * Discord's answer to a command. not-connected: the connection is not `connected` right now.
 * refused: Discord answered with an error (`code` and `message` are Discord's). no-answer: Discord
 * did not answer in time, the connection ended, or the answer was too large (LIMITS.maxDiscordAnswerBytes).
 */
export type DiscordResult =
  | { ok: true; data: JsonValue }
  | { ok: false; reason: "not-connected" | "refused" | "no-answer"; code: number | null; message: string | null };

/**
 * Discord RPC events a module may subscribe to. VOICE_CHANNEL_SELECT (the user joined, moved or left)
 * takes no channel; the others are for one voice channel and need its id.
 */
export const DISCORD_EVENTS = ["VOICE_CHANNEL_SELECT", "VOICE_STATE_CREATE", "VOICE_STATE_UPDATE", "VOICE_STATE_DELETE", "SPEAKING_START", "SPEAKING_STOP"] as const;
export type DiscordEventName = (typeof DISCORD_EVENTS)[number];

/** One Discord event, with its data as Discord sent it. */
export interface DiscordEvent {
  event: DiscordEventName;
  data: JsonValue;
}

export interface DocumentChange {
  id: string;
  revision: number;
  deleted: boolean;
}

/**
 * Capabilities gate methods beyond the always-available core. A module has a
 * capability once the user granted one of its permissions for it (`network`:
 * a host in `permissions.network`; `aiUsage`: the `ai-usage` connector; `discord`:
 * the `discord` connector; `overlay`: the `stream-overlay` connector; `systemInfo`: the `system-info` connector; `media`: the `media` connector; `leaderboards`: the `leaderboards` connector; `folders`: a folder in `permissions.folders`); calling a gated method without it fails
 * with PERMISSION_DENIED. The others cannot be granted yet.
 */
export type Capability = "network" | "aiUsage" | "discord" | "overlay" | "systemInfo" | "media" | "leaderboards" | "folders" | "files" | "clipboard" | "sharedData";

/**
 * Where the user stands with this module's leaderboards (leaderboards.status). `online`: Tavora's service answered;
 * while it can't be reached, `available` and `shown` are false and `name` is null, so ask again later. `signedIn`: signed
 * in to a Tavora account (known offline too). `available`: Tavora's service runs this module's boards (a catalog module once Tavora allowed it; a
 * development copy always, on test boards only its developer sees). `shown`: the user agreed to show their name and
 * results on this module's boards. `name`: the name the boards show for them once `shown`; null before that, so the
 * user's name reaches the module only once it is public.
 */
export interface LeaderboardStatus {
  online: boolean;
  signedIn: boolean;
  available: boolean;
  shown: boolean;
  name: string | null;
}

/**
 * One finished game on a `streak` or `rate` board. `id`: a UUID you make once per game, so sending it again changes
 * nothing. `at`: when it ended, in milliseconds since 1970 (Date.now()). `day`: the local calendar day the game
 * belongs to (YYYY-MM-DD), which decides the day, week, month and year it counts for; the SDK fills it in from `at`
 * when you leave it out. On a `daily` board it is the puzzle's day, so give it yourself there.
 */
export interface LeaderboardOutcomeResult {
  id: string;
  outcome: "won" | "lost";
  at: number;
  day?: string;
}

/**
 * One finished game on a `score`, `total` or `average` board: its number (points, a time in seconds on a board where
 * low wins, 1 to count the game on a total board). `id`, `at` and `day` as on LeaderboardOutcomeResult.
 */
export interface LeaderboardValueResult {
  id: string;
  value: number;
  at: number;
  day?: string;
}

export type LeaderboardResult = LeaderboardOutcomeResult | LeaderboardValueResult;

/**
 * A stretch of time a board can be read for: one local day, one week (Monday to Sunday), one calendar month, one
 * year, or everything (`all`, the default). A result counts for the periods its `day` is in. Streak boards have no
 * `day` period.
 */
export type LeaderboardPeriod = "day" | "week" | "month" | "year" | "all";

/**
 * Why the service refused one result; a refused result never counts, so don't send it again. `invalid`: its shape is
 * off. `time`: `at` is in the future or more than a year ago. `archive`: the game ended outside its `day` (an archive
 * replay, or a day made up later). `day-taken`: a daily board already has another result for that day. `full`: this
 * account holds too many results for this module.
 */
export type LeaderboardRejection = "invalid" | "time" | "archive" | "day-taken" | "full";

/** What leaderboards.submit did with each result: ids the board took (also ones it had already) and ids it refused. */
export interface LeaderboardSubmitResult {
  accepted: string[];
  rejected: { id: string; reason: LeaderboardRejection }[];
}

/** What leaderboards.top gives: the lines, best first. An object, so it can tell more later without breaking modules. */
export interface LeaderboardTop {
  rows: LeaderboardRow[];
}

/**
 * One line of a board. `name` is the user's Tavora name, or a neutral one such as "User · K7" when their name may not
 * be shown. `self` marks the user's own line; nothing else about who it is reaches the module. The numbers depend on
 * the board's kind (LeaderboardStanding).
 */
export interface LeaderboardRow extends LeaderboardStanding {
  name: string;
  self: boolean;
}

/**
 * Where a user stands on a board in one period. `rank`: 1 is best; equal lines share a rank. `of`: how many users the
 * board has in that period. Streak boards give `current` and `best`; score boards `value` (the best); total boards
 * `value` (the sum) and `games`; average boards `value` (the mean) and `games`; rate boards `value` (the share of
 * games won, 0 to 100), `games` and `wins`.
 */
export interface LeaderboardStanding {
  rank: number;
  of: number;
  current?: number;
  best?: number;
  value?: number;
  games?: number;
  wins?: number;
}

/** What leaderboards.mine gives: the user's own standing on each board of the manifest, in every period. */
export interface LeaderboardMine {
  boards: LeaderboardMineBoard[];
}

/** One board of the manifest (`id` and its `name` in Tavora's language), with the user's standing per period, or null where they have none. */
export interface LeaderboardMineBoard {
  id: string;
  name: string;
  periods: Record<LeaderboardPeriod, LeaderboardStanding | null>;
}

/**
 * What overlay.copyLink did. `copied`: the link is on the clipboard, ready to paste into OBS as a Browser Source.
 * `off`: Stream overlays are off in Tavora; Tavora opened the setting so the user can turn them on. `denied`: the
 * module asks for the connector on request (permissions.onRequest) and the user said no in Tavora's dialog.
 */
export type OverlayLinkResult = "copied" | "off" | "denied";

/**
 * What overlay.showOverGame did. `shown`: the overlay is over the game now (or already was). `off`: Game overlays are
 * off in Tavora; Tavora opened the setting so the user can turn them on. `full`: the overlay setup it lands in (its
 * game's, or All games from a personal workspace) already has the most items it may have (LIMITS.maxGameOverlays); the
 * user can remove one in the Overlay layout.
 */
export type GameOverlayResult = "shown" | "off" | "full";

/**
 * One thing a panel can show over the game on its own (overlay.setSources): a clock, a counter, a group of counters as one
 * line. The Overlay page lists these under the panel, and a click on one puts the overlay for its `key` into the setup.
 */
export interface OverlaySource {
  /** The overlay key it shows from, the same as for overlay.publish and overlay.showOverGame. */
  key: string;
  /** What the Overlay page calls it: the item's name, or the line a group shows. At most LIMITS.maxOverlaySourceName characters. */
  name: string;
  /** A group of several things shown as one: the list draws a link icon instead of the item icon. */
  group?: boolean;
  /**
   * How big the overlay is at its natural size, in pixels of a 1080 px high game window, as `overlaySize` in the manifest
   * is. A new frame starts at this size (with a little room around it); without it, at the manifest's `overlaySize`.
   */
  size?: { width: number; height: number };
  /**
   * The frame follows the content, like an OBS text source without a bounding box: it is as big as `size` (with the
   * room around it) times the scale the user drags it to, and grows or shrinks with `size` whenever the panel lists a
   * new one. Reset size puts the scale back to 100 %. The page takes the scale from its height (`inTavoraFrame`).
   * `false` (or left out): the user sizes the frame and the page fits itself in; with `false` Tavora also knows that the
   * content is drawn at 100 % in it, so it keeps its size if it grows later. Tavora 0.23.94 and newer; older ones ignore it.
   */
  grows?: boolean;
}

/** A hotkey the user set for this module in the current workspace: which action, for what. Never the key itself. */
export interface HotkeyBinding {
  /** One of the manifest's `actions` ids. */
  action: string;
  /** The module's own id for what the action works on, such as an item id. */
  target: string;
}

/** What the user did in Tavora's hotkey dialog (hotkeys.set): set a key, removed the one set, or closed it. */
export type HotkeySetResult = "set" | "removed" | "cancelled";

/** Request methods and their params/result types. */
export interface ReadOnlyFile { id: string; name: string; size: number }
/** Where files.pickReadOnly starts: in the folder of a file this module linked, `up` folders higher (0 to 3). */
export interface PickNear { file: string; up?: number }
/**
 * What files.check found. `found`: the file is where it was, with its size in bytes and when it last changed (ms since
 * 1970). `gone`: it was deleted, moved or renamed. `unlinked`: this PC has no link for the id (another PC made it, or
 * it was forgotten).
 */
export type ReadOnlyFileState = { found: true; size: number; modifiedAt: number } | { found: false; reason: "gone" | "unlinked" };
export const READ_ONLY_FILE_PATH = '/_read-only-files/';
/** The biggest file `files.read` gives: 50 MiB (32 MiB before Tavora 0.23.6). */
export const MAX_READ_ONLY_FILE_BYTES = 50 * 1024 * 1024;
/**
 * A file in a folder this module may read (permissions.folders): its path inside the folder joined by `/` (such as
 * `Saves/slot 1.sav`), its size in bytes, when it last changed (ms since 1970), and whether the module may read it
 * (an extension of `read`) or only see it (one of `names`).
 */
export interface FolderEntry { path: string; size: number; modifiedAt: number; readable: boolean }
/** What folders.list found. `truncated`: the folder holds more than one listing may (20,000 files or 5,000 folders). */
export interface FolderListing { files: FolderEntry[]; truncated: boolean }
/**
 * Whether a folder of permissions.folders can be read now. `missing`: it isn't where the manifest says and the user
 * hasn't shown Tavora where it is (folders.choose). `not-granted`: the user hasn't allowed it, or took it back.
 */
export type FolderState = { found: true } | { found: false; reason: "missing" | "not-granted" };
/**
 * Files the module may see that were added or changed (`changed`) or removed (`removed`, their paths) in a watched
 * folder. `rescan`: Tavora can't say which, so list the folder again.
 */
export interface FolderChange { folder: string; changed: FolderEntry[]; removed: string[]; rescan: boolean }
/** Where folders.read asks for a file, by POST with `{ folder, path }` as JSON. */
export const FOLDER_READ_PATH = '/_folders/read';
export interface Methods {
  /** Whether a folder of permissions.folders can be read now, without saying where it is. Tavora 0.23.113 and newer. */
  "folders.state": { params: { folder: string }; result: FolderState };
  /** The files the module may see in a folder, subfolders too (8 deep). Tavora 0.23.113 and newer. */
  "folders.list": { params: { folder: string }; result: FolderListing };
  /** Starts (`on`) or stops telling this panel about changes in a folder (event folders.changed). Tavora 0.23.113 and newer. */
  "folders.watch": { params: { folder: string; on: boolean }; result: null };
  /**
   * Opens the system's folder dialog so the user can show Tavora where the folder is, when it isn't where the manifest
   * says. Only right after a click. True when the user chose a folder Tavora accepts. Tavora 0.23.113 and newer.
   */
  "folders.choose": { params: { folder: string }; result: boolean };
  /**
   * Shows a file of a folder in Explorer with the file selected (or, when it is gone, the folder it was in; nothing when
   * that is gone too), like files.showInFolder does for a picked file. `path` is inside the folder, joined by `/`, and of
   * an extension the manifest lists (`read` or `names`). Only right after a click. Resolves with null whether or not
   * anything was shown, and tells the module nothing back. Tavora 0.23.116 and newer.
   */
  "folders.showInFolder": { params: { folder: string; path: string }; result: null };
  /**
   * Opens Tavora's open dialog after a click and remembers read-only access to the file picked. With `multiple: true`
   * the user can pick several, and the answer is a list (empty when the dialog was closed). `multiple` needs Tavora 0.23.6.
   */
  "files.pickReadOnly": { params: { extensions: string[]; multiple?: boolean; near?: PickNear }; result: ReadOnlyFile | ReadOnlyFile[] | null };
  "files.forget": { params: { id: string }; result: null };
  /** Whether a file this module linked in this workspace is still there, without reading it. Tavora 0.23.6 and newer. */
  "files.check": { params: { id: string }; result: ReadOnlyFileState };
  /** Opens the folder of a file this module linked, with the file selected. Only right after a click. Tavora 0.23.6 and newer. */
  "files.showInFolder": { params: { id: string }; result: null };
  "bridge.handshake": { params: { protocol: number; sdkVersion: string }; result: HandshakeResult };
  /** The workspace the panel is in. Tavora 0.21.43 and newer. */
  "workspace.getCurrent": { params: undefined; result: TavoraWorkspace };
  "storage.get": { params: { key: string }; result: JsonValue | null };
  "storage.set": { params: { key: string; value: JsonValue }; result: null };
  "storage.delete": { params: { key: string }; result: null };
  "storage.keys": { params: undefined; result: string[] };
  /**
   * Sets `value` only while the key holds `expected` (null: the key is not set), in one step, so two panels can't
   * overwrite each other's change; whether it was set. Tavora 0.21.92 and newer.
   */
  "storage.compareAndSet": { params: { key: string; expected: JsonValue | null; value: JsonValue }; result: boolean };
  /** The same calls for settings shared by every workspace: this module's own, in all workspaces. */
  "storage.app.get": { params: { key: string }; result: JsonValue | null };
  "storage.app.set": { params: { key: string; value: JsonValue }; result: null };
  "storage.app.delete": { params: { key: string }; result: null };
  "storage.app.keys": { params: undefined; result: string[] };
  "storage.app.compareAndSet": { params: { key: string; expected: JsonValue | null; value: JsonValue }; result: boolean };
  "documents.list": { params: undefined; result: DocumentSummary[] };
  "documents.get": { params: { id: string }; result: TavoraDocument | null };
  "documents.put": { params: PutDocumentParams; result: DocumentSummary };
  "documents.delete": { params: { id: string; ifRevision?: number }; result: null };
  "panel.getState": { params: undefined; result: JsonValue | null };
  "panel.setState": { params: { value: JsonValue | null }; result: null };
  /** Why this page is loading; the same answer for every call until the page loads again. Tavora 0.17.17 and newer. */
  "panel.getLaunch": { params: undefined; result: PanelLaunch };
  /** What the panel shows now, or null for nothing. Tavora 0.17.17 and newer. */
  "panel.setContent": { params: { content: PanelContent | null }; result: null };
  /**
   * The answer to a `panel.navigate` event: `handled` is false when the page takes no navigation (no handler), `ok`
   * whether it now shows the content. Tavora 0.17.18 and newer.
   */
  "panel.navigated": { params: { requestId: number; handled: boolean; ok: boolean }; result: null };
  /** Whether the panel fills the workspace now (Maximize). Tavora 0.20.20 and newer. */
  "panel.isMaximized": { params: undefined; result: boolean };
  /**
   * Makes the panel fill the workspace (true), as Maximize in its menu does, or puts it back (false). Filling it
   * only right after a click or key press in the panel. Tavora 0.20.20 and newer.
   */
  "panel.setMaximized": { params: { maximized: boolean }; result: null };
  /**
   * Whether this panel is over the game now: Tavora lends it to the in-game layer while the user holds the layer open, in
   * its spot there and see-through. `PANEL_OVER_GAME_TAVORA` and newer.
   */
  "panel.isOverGame": { params: undefined; result: boolean };
  /**
   * Shows the panel big in a dialog centred over the workspace (open: true), with the module's name and a close button
   * over the dimmed app, or puts it back in its slot (false). `width` and `height` (240 to 2000, default 560 x 640) are
   * the page's size in it; Tavora makes it fit the workspace. Opening only right after a click or key press in the panel,
   * or once within 10 seconds of the page starting for a panel whose launch reason is `add` (a welcome).
   * Tavora 0.21.95 and newer.
   */
  "panel.setDialog": { params: { open: boolean; width?: number; height?: number }; result: null };
  /**
   * Changes the title in the frame of the panel's dialog (the module's name by default) while it is open, for example to name
   * the thing its settings are about; `null` goes back to the module's name. A title of 1 to LIMITS.maxTitleLength characters,
   * shown as plain text on one line. Nothing happens while the panel has no dialog open (the next one starts with the module's
   * name again). Needs no click and no permission. Tavora 0.23.71 and newer.
   */
  "panel.setDialogTitle": { params: { title: string | null }; result: null };
  /** What this panel's live view (the overlay page shown in its spot over the game) shows; null shows nothing. At most LIMITS.maxOverlayStateBytes. Tavora 0.21.11 and newer. */
  "panel.setLive": { params: { state: JsonValue | null }; result: null };
  /**
   * Opens one of this module's own panel types in the current workspace, optionally on some content. Only right after a
   * click or key press in the panel, once per click. Tavora 0.17.18 and newer.
   */
  "panels.open": { params: { type: string; content?: PanelContent }; result: PanelOpenResult };
  /**
   * Opens several of this module's own panel types at once, each at most once and without content, in the current
   * workspace: inside the asking panel's group, as the manifest's `panelLayout` lays them out. A type already open comes
   * to the front where it is. Only right after a click or key press in the panel; one press covers the whole call.
   * Answers per type. Tavora 0.23.29 and newer.
   */
  "panels.openMany": { params: { types: string[] }; result: Record<string, PanelOpenManyResult> };
  "workspace.getViewport": { params: undefined; result: TavoraViewport };
  "ui.getTheme": { params: undefined; result: TavoraTheme };
  /** The language of Tavora's own texts, as a code such as "en" or "de". */
  "ui.getLanguage": { params: undefined; result: string };
  /** Shows a menu drawn by Tavora above every panel. Only right after a click, right-click or key press in the panel. The chosen item's id, or null. */
  "ui.showMenu": { params: MenuRequest; result: string | null };
  "ui.tooltip.show": { params: TooltipRequest; result: boolean };
  "ui.tooltip.move": { params: TooltipAnchor; result: null };
  "ui.tooltip.hide": { params: { id: string }; result: null };
  "ui.tooltip.close": { params: { id: string }; result: null };
  /**
   * Defines (or replaces) one of this module's item-card skins, for every panel of the module until Tavora restarts.
   * Names are 1 to 32 of a-z, 0-9 and `-`; at most 32 per module. Tavora checks the files and the colours' contrast and
   * refuses a skin that fails (INVALID_PARAMS, with the reason). Tavora `ITEM_CARD_TAVORA` and newer.
   */
  "ui.tooltip.defineSkin": { params: { name: string; skin: TooltipSkin }; result: null };
  /** Opens a web address in the workspace's Browser panel. Only right after a click or key press in the panel; http and https only. */
  "links.open": { params: { url: string }; result: null };
  "blobs.list": { params: undefined; result: BlobInfo[] };
  "blobs.usage": { params: undefined; result: BlobUsage };
  "blobs.delete": { params: { id: string }; result: null };
  /** The same three for the module's files shared by every workspace (blobs.app). */
  "blobs.app.list": { params: undefined; result: BlobInfo[] };
  "blobs.app.usage": { params: undefined; result: BlobUsage };
  "blobs.app.delete": { params: { id: string }; result: null };
  /** A web request to a granted host (capability `network`). */
  "network.fetch": { params: NetworkRequest; result: NetworkResponse };
  "network.readPage": { params: { url: string }; result: PageResponse };
  /** The AI accounts the user set up, in their order (capability `aiUsage`). */
  "aiUsage.accounts": { params: undefined; result: AiUsageAccountInfo[] };
  /** Where the user stands with this module's leaderboards (capability `leaderboards`); `online` is false while Tavora's service can't be reached. Tavora 0.21.92 and newer. */
  "leaderboards.status": { params: undefined; result: LeaderboardStatus };
  /**
   * Asks the user, in Tavora's own words in this panel, whether to show their name and results on this module's boards
   * (signed out, it offers to sign in instead); the status after their answer. Only right after a click or key press in
   * the panel (capability `leaderboards`). Tavora 0.21.92 and newer.
   */
  "leaderboards.show": { params: undefined; result: LeaderboardStatus };
  /** Takes the user off this module's boards and deletes their results there. Only right after a click or key press (capability `leaderboards`). Tavora 0.21.92 and newer. */
  "leaderboards.hide": { params: undefined; result: LeaderboardStatus };
  /**
   * Sends finished games to one of the manifest's boards, up to LIMITS.maxLeaderboardResults at once; each is taken or
   * refused on its own. PERMISSION_DENIED while the user is signed out or hasn't agreed (status), NETWORK_ERROR while
   * the service can't be reached: keep the results and send them later (capability `leaderboards`). Tavora 0.21.92 and newer.
   */
  "leaderboards.submit": { params: { board: string; results: LeaderboardResult[] }; result: LeaderboardSubmitResult };
  /**
   * The best lines of one of the manifest's boards, `limit` of them (default 20, at most LIMITS.maxLeaderboardRows). When
   * the user is on the board but further down, their own line comes last. `period`: which stretch of time (default
   * `all`); `day`: the user's local day (YYYY-MM-DD), which picks the period that holds it (default today) and, on a
   * daily board, shows a streak whose last day was before yesterday as ended (capability `leaderboards`). Tavora 0.21.92 and newer, `period` 0.21.97.
   */
  "leaderboards.top": { params: { board: string; period?: LeaderboardPeriod; day?: string; limit?: number }; result: LeaderboardTop };
  /**
   * The user's own standing on every board of the manifest, in every period, in one call; `day` as on leaderboards.top
   * (capability `leaderboards`). Signed out or not shown, every standing is null. Tavora 0.21.97 and newer.
   */
  "leaderboards.mine": { params: { day?: string }; result: LeaderboardMine };
  /** Reads one account's usage (capability `aiUsage`). */
  "aiUsage.read": { params: { accountId: string }; result: AiUsageReading };
  /** What this PC is: processor, memory, graphics cards and drives. Read once and kept (capability `systemInfo`). Tavora 0.21.1 and newer. */
  "systemInfo.info": { params: undefined; result: SystemInfo };
  /**
   * Sets what this panel watches, replacing what it watched before; nothing in `blocks` stops it (capability
   * `systemInfo`). Tavora reads the PC only while a panel that is shown watches, and sends a first
   * `systemInfo.snapshot` at once, then one every `intervalMs`. A panel that is hidden gets none.
   */
  "systemInfo.watch": { params: { blocks: SystemWatchBlocks; intervalMs: SystemInterval }; result: null };
  /** The drops of the connection in the last 30 days (capability `systemInfo`). Tavora 0.21.22 and newer. */
  "systemInfo.connectionLog": { params: undefined; result: SystemConnectionLog };
  /** Empties the log of drops. Only for Tavora's own System Monitor, right after a click or key press (capability `systemInfo`). Tavora 0.21.22 and newer. */
  "systemInfo.clearConnectionLog": { params: undefined; result: null };
  /** Whether the connection is watched and which address is pinged (capability `systemInfo`). Tavora 0.21.22 and newer. */
  "systemInfo.connectionSettings": { params: undefined; result: SystemConnectionSettings };
  /**
   * Changes what is given and leaves the rest. Only for Tavora's own System Monitor, right after a click or key press, and
   * once every 5 seconds (capability `systemInfo`). A `target` that is not a public IPv4 address or a public name is
   * `INVALID_PARAMS`. Tavora 0.21.22 and newer.
   */
  "systemInfo.setConnectionSettings": { params: Partial<SystemConnectionSettings>; result: SystemConnectionSettings };
  /**
   * The apps running now, with their memory and CPU. Only for Tavora's own System Monitor (capability `systemInfo`);
   * any other module gets PERMISSION_DENIED. Tavora 0.21.21 and newer.
   */
  "systemInfo.apps": { params: undefined; result: SystemApps };
  /** What this PC received and sent this week and month and the 3 months before (capability `systemInfo`). Only for Tavora's own System Monitor. Tavora 0.21.31 and newer. */
  "systemInfo.traffic": { params: undefined; result: SystemTraffic };
  /**
   * Starts (`on: true`) or ends this panel's watch of what plays on this PC (capability `media`) and answers what
   * plays now; `media.changed` follows every change while it watches, also while the panel is hidden, so an
   * overlay can stay current. Ending answers null. Tavora 0.21.18 and newer.
   */
  "media.watch": { params: { on: boolean }; result: MediaState | null };
  /**
   * Asks the app of a session to play or pause, skip to the next or go back (capability `media`). Needs a click or
   * key press in the panel, or one of the module's hotkeys, just before; one press allows one call. True when the
   * app took it.
   */
  "media.control": { params: { session: string; action: MediaAction }; result: boolean };
  /** The connection to the Discord app; starts it for this panel (capability `discord`). */
  "discord.state": { params: undefined; result: DiscordState };
  /** Signs in, asking for approval in Discord when needed. Only right after a click or key press (capability `discord`). */
  "discord.connect": { params: undefined; result: null };
  /** Asks Discord to approve muting and deafening for an older sign-in. Only right after a click or key press (capability `discord`). */
  "discord.allowControl": { params: undefined; result: null };
  /** One Discord RPC command from DISCORD_COMMANDS (capability `discord`). */
  "discord.command": { params: { command: DiscordCommand; args: DiscordCommands[DiscordCommand] }; result: DiscordResult };
  /** Starts sending one Discord event to this panel; kept across reconnects until unsubscribed (capability `discord`). */
  "discord.subscribe": { params: { event: DiscordEventName; channelId?: string }; result: null };
  "discord.unsubscribe": { params: { event: DiscordEventName; channelId?: string }; result: null };
  /** A picture from Discord's image server (someone's avatar, a server icon) as a small PNG data address, or null (capability `discord`). */
  "discord.image": { params: { url: string }; result: string | null };
  /**
   * What the overlay page for `key` shows now (capability `overlay`): any JSON, at most LIMITS.maxOverlayStateBytes.
   * Tavora keeps it, so the overlay shows it while no panel runs. Tavora 0.19.26 and newer.
   */
  "overlay.publish": { params: { key: string; state: JsonValue }; result: null };
  /** The overlay for `key` shows nothing until it is published again; its link stays the same (capability `overlay`). */
  "overlay.remove": { params: { key: string }; result: null };
  /**
   * Puts the link of the overlay for `key` on the clipboard. Only right after a click or key press (capability `overlay`;
   * a module that asks for it on request gets Tavora's consent dialog first).
   */
  "overlay.copyLink": { params: { key: string }; result: OverlayLinkResult };
  /** Gives the overlay for `key` a new link; the old one stops working (capability `overlay`). */
  "overlay.resetLink": { params: { key: string }; result: null };
  /**
   * Shows the overlay page for `key` over the user's game, in a Tavora window above it. Only right after a click or
   * key press in the panel; needs no capability. Tavora 0.20.51 and newer.
   */
  "overlay.showOverGame": { params: { key: string }; result: GameOverlayResult };
  /**
   * Takes this module's game overlay for `key` away in the panel's workspace scope (game or general). Needs no click and
   * no capability; nothing happens when there is none. Tavora 0.21.3 and newer.
   */
  "overlay.hideOverGame": { params: { key: string }; result: null };
  /** The keys of this module's game overlays in the panel's workspace scope. Needs no capability. Tavora 0.21.3 and newer. */
  "overlay.overGame": { params: undefined; result: string[] };
  /**
   * Tells Tavora what this panel can show over the game on its own: one entry per item, each with the overlay key it shows
   * from. The Overlay page lists them under the panel, and a panel that has sent a list can only be added through it, not
   * as a whole. The last call wins and is kept while the panel exists; an empty list says there is nothing to show right now (the panel is still not offered as a whole). Needs no click
   * and no capability. At most LIMITS.maxOverlaySources entries. Tavora 0.23.43 and newer.
   */
  "overlay.setSources": { params: { sources: OverlaySource[] }; result: null };
  /**
   * Opens (or brings forward) a small Tavora window with the overlay page for `key` at its real size, for the user to
   * see what it looks like. Only right after a click or key press in the panel; needs no capability, but the module must
   * have an `overlay` in its manifest. Tavora 0.21.3 and newer.
   */
  "overlay.preview": { params: { key: string }; result: null };
  /**
   * Shows Tavora's Overlay page, where the user adds the module's overlays to their game and arranges them, and closes this
   * panel's dialog if it is open. Only right after a click or key press in the panel; needs no capability. It opens nothing
   * the user can't open themselves and tells the module nothing. Tavora 0.23.77 and newer.
   */
  "overlay.openPage": { params: undefined; result: null };
  /**
   * Puts plain text on the system clipboard (at most `LIMITS.maxClipboardTextBytes` as UTF-8, never empty). Only right
   * after a click or key press, one copy per press; there is no call to read the clipboard. Tavora 0.25.23+.
   */
  "clipboard.writeText": { params: { text: string }; result: null };
  /** The hotkeys the user set for this module in the current workspace. Tavora 0.19.26 and newer. */
  "hotkeys.list": { params: undefined; result: HotkeyBinding[] };
  /**
   * Opens Tavora's dialog to set the key for one of the manifest's `actions` on `target`; `label` names the target
   * there, such as an item's name. Only right after a click or key press.
   */
  "hotkeys.set": { params: { action: string; target: string; label: string }; result: HotkeySetResult };
  /** Removes the hotkeys for `target`: all of them, or only the one for `action`. */
  "hotkeys.remove": { params: { target: string; action?: string }; result: null };
}

export type MethodName = keyof Methods;

/** Methods reserved for later milestones, and the capability each needs. */
export const RESERVED_METHODS: Readonly<Record<string, Capability>> = {
  "clipboard.readText": "clipboard",
  "sharedData.publish": "sharedData",
  "sharedData.read": "sharedData",
  "sharedData.subscribe": "sharedData",
};

/** Events the host pushes to the module. */
export interface Events {
  "ui.tooltipClosed": { id: string };
  "workspace.resize": TavoraViewport;
  "ui.theme": TavoraTheme;
  "ui.language": string;
  "documents.changed": DocumentChange;
  /** How busy the PC is, for what this panel watches (systemInfo.watch). Only with capability `systemInfo`. */
  "systemInfo.snapshot": SystemSnapshot;
  /** A drive was plugged in or removed; ask systemInfo.info again. Only with capability `systemInfo`, while the panel watches. */
  "systemInfo.drivesChanged": null;
  /**
   * The connection went down, changed kind or came back. Only with capability `systemInfo`, while the panel watches
   * the `connection` block and is shown. Ask systemInfo.connectionLog again. Tavora 0.21.22 and newer.
   */
  "systemInfo.connectionChanged": SystemConnection;
  /** What plays on this PC changed (media.watch). Only with capability `media`, while the panel watches. */
  "media.changed": MediaState;
  /** Files changed in a folder this panel watches (folders.watch). Only with capability `folders`. Tavora 0.23.113 and newer. */
  "folders.changed": FolderChange;
  /** The user added, renamed or removed an AI account; ask aiUsage.accounts again. Only with capability `aiUsage`. */
  "aiUsage.accountsChanged": null;
  /** The connection to the Discord app changed. Only with capability `discord`, after discord.state. */
  "discord.state": DiscordState;
  /** A Discord event this panel subscribed to. Only with capability `discord`. */
  "discord.event": DiscordEvent;
  /** Another panel of this module asked this one to show other content; answer with `panel.navigated` within navigateTimeoutMs. */
  "panel.navigate": PanelNavigateRequest;
  /** The panel started or stopped filling the workspace (Maximize and Restore, by the user or panel.setMaximized). */
  "panel.maximized": { maximized: boolean };
  /** The panel's dialog opened or closed (panel.setDialog, or the user closed it). Tavora 0.21.95 and newer. */
  "panel.dialog": { open: boolean };
  /** The panel went over the game (the user opened the in-game layer) or came back to its slot. `PANEL_OVER_GAME_TAVORA` and newer. */
  "panel.overGame": { over: boolean };
  /** The user pressed a hotkey set for this module (hotkeys.set). Sent to one panel of the module in the workspace shown now, the one used last. */
  "hotkeys.pressed": HotkeyBinding;
  /**
   * The game overlays of this module in the panel's workspace scope changed without this panel asking: the user added or
   * removed one on the Overlay page. `keys` is the list overlay.overGame would give now. Tavora 0.23.43 and newer.
   */
  "overlay.overGameChanged": { keys: string[] };
  /**
   * The user pressed Settings on an overlay's frame on the Overlay page. Tavora has put this panel in its dialog (as after
   * panel.setDialog) and `key` is the overlay's key: show the settings of what it shows. Tavora 0.23.43 and newer.
   */
  "panel.openSettings": { key: string };
  "lifecycle.suspend": null;
  "lifecycle.resume": null;
  /**
   * Tavora's window went behind another program, usually the game (`behind: true`), or came back in front. The panel is
   * not hidden and keeps running; only what the user must be there to see (a toast with Undo) should wait. Also sent
   * right after the handshake if the panel connects while the window is behind. Tavora 0.23.82 and newer.
   */
  "lifecycle.behind": { behind: boolean };
  "lifecycle.dispose": null;
}

export type EventName = keyof Events;

export type ErrorCode =
  /** Malformed message, wrong protocol version or over a limit. */
  | "BAD_REQUEST"
  /** The method is not part of the protocol. */
  | "UNKNOWN_METHOD"
  /** Params are missing or have the wrong shape. */
  | "INVALID_PARAMS"
  /** The method exists but this module has not been granted its capability. */
  | "PERMISSION_DENIED"
  /** A storage, document or panel-state limit would be exceeded, or a network answer was too large. */
  | "QUOTA_EXCEEDED"
  /** A network request failed, timed out or was cancelled. readPage also refuses login/verification pages; fetch returns HTTP error statuses as answers. */
  | "NETWORK_ERROR"
  /** `ifRevision` did not match the stored revision. */
  | "CONFLICT"
  /** The SDK and host speak different protocol versions. */
  | "INCOMPATIBLE"
  /** Something failed inside the host. Details are logged there, not sent. */
  | "INTERNAL"
  // Raised by the SDK itself, never sent by the host:
  /** The host did not answer in time. */
  | "TIMEOUT"
  /** connect() found no Tavora host, e.g. the page was opened in a normal browser. */
  | "HOST_UNAVAILABLE";

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
  /** Present for PERMISSION_DENIED. */
  capability?: Capability;
  /** Present for CONFLICT. */
  revision?: number;
  /** Present for INCOMPATIBLE and BAD_REQUEST version errors. */
  supported?: number[];
}

export interface RequestMessage {
  v: typeof PROTOCOL_VERSION;
  id: number;
  method: string;
  params?: unknown;
}

export type ResponseMessage =
  | { v: typeof PROTOCOL_VERSION; id: number; ok: true; result: unknown }
  | { v: typeof PROTOCOL_VERSION; id: number; ok: false; error: ErrorPayload };

export interface EventMessage {
  v: typeof PROTOCOL_VERSION;
  event: EventName;
  data: unknown;
}

export type HostMessage = ResponseMessage | EventMessage;

export const LIMITS = {
  /** Largest serialized request the host accepts. */
  maxMessageBytes: 8 * 1024 * 1024,
  /** Requests a module may have waiting at once. */
  maxInFlight: 64,
  maxKeyLength: 256,
  /** Settings storage per module and workspace. */
  maxStoreBytes: 5 * 1024 * 1024,
  /** One document's data. */
  maxDocumentBytes: 4 * 1024 * 1024,
  /** All documents of one module in one workspace. */
  maxDocumentsBytes: 50 * 1024 * 1024,
  maxDocuments: 1000,
  maxTitleLength: 200,
  /** A panel content's id (panel.setContent); its title has maxTitleLength. */
  maxContentIdLength: 200,
  /** How long a panel has to save and switch after a panel.navigate event before Tavora counts it as failed. */
  navigateTimeoutMs: 5_000,
  /** UI state for one panel. */
  maxPanelStateBytes: 256 * 1024,
  /** One stored file (see Blobs). */
  maxBlobBytes: 50 * 1024 * 1024,
  /** All stored files of one module in one workspace. */
  maxBlobsBytes: 500 * 1024 * 1024,
  /** A PNG a module puts on the clipboard. */
  maxClipboardImageBytes: 20 * 1024 * 1024,
  /** Text a module puts on the clipboard, as UTF-8. */
  maxClipboardTextBytes: 1024 * 1024,
  /** The body of one network.fetch answer, before any base64. A longer answer fails with QUOTA_EXCEEDED. */
  maxNetworkResponseBytes: 5 * 1024 * 1024,
  /** How long one network.fetch may take, redirects included. */
  networkTimeoutMs: 15_000,
  /** Deadline for an isolated page import, including cleanup. */
  pageTimeoutMs: 30_000,
  /** Redirects one network.fetch follows; each must go to a granted host. */
  maxNetworkRedirects: 5,
  /** network.fetch calls one panel may have running at once; more fail with BAD_REQUEST. */
  maxNetworkInFlight: 6,
  /** How often Tavora reads one AI account at most, for every module together; asking sooner gives the last reading. */
  aiUsageMinReadMs: 60_000,
  /** Results one leaderboards.submit may send. */
  maxLeaderboardResults: 50,
  /** Lines one leaderboards.top gives at most. */
  maxLeaderboardRows: 100,
  /** How long one aiUsage.read may take; the Codex command line can be slow to start. */
  aiUsageTimeoutMs: 40_000,
  /** How long one discord.command may take; a slower answer is `no-answer`. */
  discordTimeoutMs: 15_000,
  /** Largest Discord answer or event passed on, as JSON; a larger one is `no-answer` (or dropped, for an event). */
  maxDiscordAnswerBytes: 512 * 1024,
  /** Discord events one panel may subscribe to at once. */
  maxDiscordSubscriptions: 32,
  /** Entries in one menu, submenus included. */
  maxMenuEntries: 100,
  /** Characters of a menu label or heading. */
  maxMenuLabel: 80,
  /** Characters of the hint on the right of a menu item, such as a shortcut. */
  maxMenuHint: 30,
  /** Characters of why a menu item is off (its `disabledReason`). */
  maxMenuReason: 120,
  /** What one overlay shows (overlay.publish), as JSON. */
  maxOverlayStateBytes: 16 * 1024,
  /** Overlays one module may have in one workspace; publishing more fails with QUOTA_EXCEEDED. */
  maxOverlays: 200,
  /** Game overlays (overlay.showOverGame) one game may have at once. */
  maxGameOverlays: 8,
  /** Entries in one panel's overlay.setSources list. */
  maxOverlaySources: 64,
  /** Characters of the name of one of them. */
  maxOverlaySourceName: 100,
  /** Hotkeys one module may have in one workspace. */
  maxHotkeys: 100,
  /** Characters of the label hotkeys.set shows for its target. */
  maxHotkeyLabel: 60,
} as const;

/** Overlay keys and hotkey targets: the module's own ids, like document ids. */
export const OVERLAY_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** Ids of a manifest's panel types and actions: a lowercase letter, then up to 31 lowercase letters, digits and `-`. */
const MANIFEST_ID = /^[a-z][a-z0-9-]{0,31}$/;
/** Whether `value` can be the id of a panel type in a manifest's `panels`. */
export function isPanelTypeId(value: unknown): value is string {
  return typeof value === "string" && MANIFEST_ID.test(value);
}
/** Whether `value` can be the id of an action in a manifest's `actions`. */
export function isActionId(value: unknown): value is string {
  return typeof value === "string" && MANIFEST_ID.test(value);
}

/**
 * Why Tavora refuses a call's params, or the params as Tavora takes them. Tavora's bridge and the memory host of
 * `@tavora/sdk/testing` check params with the same functions (`check*` below), so a module test refuses what Tavora
 * refuses.
 */
export type ParamCheck<T> = { ok: true; value: T } | { ok: false; code: "INVALID_PARAMS" | "QUOTA_EXCEEDED"; message: string };

const accept = <T>(value: T): ParamCheck<T> => ({ ok: true, value });
const refuse = <T>(message: string, code: "INVALID_PARAMS" | "QUOTA_EXCEEDED" = "INVALID_PARAMS"): ParamCheck<T> => ({ ok: false, code, message });
const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** An overlay key (`params.key`) or a hotkey target (`params.target`): OVERLAY_KEY. */
export function checkModuleKey(value: unknown, name: "key" | "target"): ParamCheck<string> {
  return typeof value === "string" && OVERLAY_KEY.test(value) ? accept(value) : refuse(`params.${name} must be 1 to 64 letters, digits, - and _`);
}

/**
 * overlay.setSources' list: at most LIMITS.maxOverlaySources entries, each with its own key, a name, and a size in plain
 * numbers. `limits` lowers them (the memory host's `limits` option).
 */
export function checkOverlaySources(value: unknown, limits: { maxOverlaySources: number; maxOverlaySourceName: number } = LIMITS): ParamCheck<OverlaySource[]> {
  if (!Array.isArray(value)) return refuse("params.sources must be a list");
  if (value.length > limits.maxOverlaySources) return refuse(`a panel may list at most ${limits.maxOverlaySources} sources`, "QUOTA_EXCEEDED");
  const seen = new Set<string>();
  const sources: OverlaySource[] = [];
  for (const entry of value) {
    if (!isPlainObject(entry)) return refuse("params must be an object");
    const key = checkModuleKey(entry.key, "key");
    if (!key.ok) return key;
    if (seen.has(key.value)) return refuse(`the key ${key.value} is listed twice`);
    seen.add(key.value);
    const name = entry.name;
    if (typeof name !== "string" || name.trim().length === 0 || name.length > limits.maxOverlaySourceName) return refuse(`each source needs a name of 1 to ${limits.maxOverlaySourceName} characters`);
    if (entry.group !== undefined && typeof entry.group !== "boolean") return refuse("a source's group must be true or false");
    if (entry.grows !== undefined && typeof entry.grows !== "boolean") return refuse("a source's grows must be true or false");
    // Control characters and line breaks become spaces: Tavora draws the name on one line, as plain text.
    const source: OverlaySource = { key: key.value, name: name.replace(/[\u0000-\u001f\u007f]+/g, " ").trim() };
    if (entry.group === true) source.group = true;
    if (typeof entry.grows === "boolean") source.grows = entry.grows;
    if (entry.size !== undefined) {
      if (!isPlainObject(entry.size)) return refuse("params must be an object");
      const side = (number: unknown) => (typeof number === "number" && Number.isFinite(number) && number > 0 && number <= 4000 ? Math.round(number) : null);
      const width = side(entry.size.width);
      const height = side(entry.size.height);
      if (width === null || height === null) return refuse("a source's size must be a width and a height of 1 to 4000 pixels");
      source.size = { width, height };
    }
    sources.push(source);
  }
  return accept(sources);
}

/** clipboard.writeText's text: a string that isn't empty, at most LIMITS.maxClipboardTextBytes as UTF-8 (QUOTA_EXCEEDED past it). */
export function checkClipboardText(value: unknown, max: number = LIMITS.maxClipboardTextBytes): ParamCheck<string> {
  if (typeof value !== "string" || value === "") return refuse("params.text must be text that isn't empty");
  // A UTF-8 byte is at most one per UTF-16 unit times three; count exactly only when it could be over.
  if (value.length * 3 > max && new TextEncoder().encode(value).byteLength > max) return refuse(`params.text can be at most ${max} bytes`, "QUOTA_EXCEEDED");
  return accept(value);
}

/** hotkeys.set's label: 1 to LIMITS.maxHotkeyLabel characters on one line, trimmed. */
export function checkHotkeyLabel(value: unknown, max: number = LIMITS.maxHotkeyLabel): ParamCheck<string> {
  if (typeof value !== "string" || value.trim() === "" || value.length > max || /[\u0000-\u001f]/.test(value)) {
    return refuse(`params.label must be 1 to ${max} characters on one line`);
  }
  return accept(value.trim());
}

/** An action of the manifest's `actions` (hotkeys.set, hotkeys.remove); whether the manifest lists it is Tavora's to check. */
export function checkActionId(value: unknown): ParamCheck<string> {
  return isActionId(value) ? accept(value) : refuse("params.action must be one of the manifest's actions ids");
}

/** panel.setDialogTitle's title: null, or 1 to LIMITS.maxTitleLength characters once trimmed. */
export function checkDialogTitle(value: unknown, max: number = LIMITS.maxTitleLength): ParamCheck<string | null> {
  const text = typeof value === "string" ? value.trim() : value;
  if (text === null) return accept(null);
  if (typeof text !== "string" || text.length < 1 || text.length > max) return refuse(`params.title must be null or a string of 1 to ${max} characters`);
  return accept(text);
}

/** The id of a stored file (blobs.delete, blobs.app.delete): BLOB_ID. */
export function checkBlobId(value: unknown): ParamCheck<string> {
  return typeof value === "string" && BLOB_ID.test(value) ? accept(value) : refuse("id must be the id of a stored file");
}

/** A linked file's id (files.read, files.forget, files.check, files.showInFolder): 32 lowercase hex characters. */
export function checkFileReference(value: unknown): ParamCheck<string> {
  return typeof value === "string" && /^[a-f0-9]{32}$/.test(value) ? accept(value) : refuse("Invalid file reference.");
}

/** files.pickReadOnly's params: 1 to 10 lowercase extensions without the dot, `multiple`, and where the picker starts (`near`). */
export function checkPickReadOnly(value: unknown): ParamCheck<{ extensions: string[]; multiple: boolean; near?: PickNear }> {
  if (!isPlainObject(value)) return refuse("params must be an object");
  const { extensions, multiple, near } = value;
  if (!Array.isArray(extensions) || !extensions.length || extensions.length > 10 || extensions.some((extension) => typeof extension !== "string" || !/^[a-z0-9]{1,12}$/.test(extension))) {
    return refuse("Choose up to ten file extensions.");
  }
  if (multiple !== undefined && typeof multiple !== "boolean") return refuse("multiple must be true or false.");
  if (near === undefined) return accept({ extensions: [...extensions] as string[], multiple: multiple === true });
  if (!isPlainObject(near)) return refuse("params must be an object");
  const up = near.up ?? 0;
  if (typeof near.file !== "string" || !/^[a-f0-9]{32}$/.test(near.file)) return refuse("near.file must be a linked file id.");
  if (typeof up !== "number" || !Number.isInteger(up) || up < 0 || up > 3) return refuse("near.up must be 0 to 3.");
  return accept({ extensions: [...extensions] as string[], multiple: multiple === true, near: { file: near.file, up } });
}

/** discord.image's address: 1 to 300 characters; whether it is on Discord's image server is Tavora's to check (it answers null). */
export function checkDiscordImage(value: unknown): ParamCheck<string> {
  return typeof value === "string" && value.length > 0 && value.length <= 300 ? accept(value) : refuse("params.url must be an address on cdn.discordapp.com");
}

// ── Leaderboards ───────────────────────────────────────────────────────

/** The periods a board can be read for. */
export const LEADERBOARD_PERIODS = ["day", "week", "month", "year", "all"] as const satisfies readonly LeaderboardPeriod[];
const LEADERBOARD_DAY = /^\d{4}-\d{2}-\d{2}$/;

function checkLeaderboardDay(day: unknown): ParamCheck<string | undefined> {
  return day === undefined || (typeof day === "string" && LEADERBOARD_DAY.test(day)) ? accept(day) : refuse("params.day must be a day as YYYY-MM-DD");
}

/** A board of the manifest's `leaderboards` by its id (`boards` lists their ids). */
function checkLeaderboardBoard(value: unknown, boards: readonly string[]): ParamCheck<string> {
  return typeof value === "string" && boards.includes(value) ? accept(value) : refuse("params.board must be the id of a board in the manifest's leaderboards");
}

/** leaderboards.submit's params: a board of the manifest and 1 to LIMITS.maxLeaderboardResults results. Each result is the service's to check. */
export function checkLeaderboardSubmit(value: unknown, boards: readonly string[], max: number = LIMITS.maxLeaderboardResults): ParamCheck<{ board: string; results: unknown[] }> {
  const input = isPlainObject(value) ? value : {};
  const board = checkLeaderboardBoard(input.board, boards);
  if (!board.ok) return board;
  const results = input.results;
  if (!Array.isArray(results) || results.length === 0 || results.length > max) return refuse(`params.results must be 1 to ${max} results`);
  return accept({ board: board.value, results });
}

/** leaderboards.top's params: a board of the manifest, and optionally a period, a day and a limit of 1 to LIMITS.maxLeaderboardRows lines. */
export function checkLeaderboardTop(value: unknown, boards: readonly string[], max: number = LIMITS.maxLeaderboardRows): ParamCheck<{ board: string; period?: LeaderboardPeriod; day?: string; limit?: number }> {
  const input = isPlainObject(value) ? value : {};
  const board = checkLeaderboardBoard(input.board, boards);
  if (!board.ok) return board;
  const { period, limit } = input;
  if (period !== undefined && !LEADERBOARD_PERIODS.includes(period as LeaderboardPeriod)) return refuse(`params.period must be one of ${LEADERBOARD_PERIODS.join(", ")}`);
  const day = checkLeaderboardDay(input.day);
  if (!day.ok) return day;
  if (limit !== undefined && (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > max)) return refuse(`params.limit must be a whole number from 1 to ${max}`);
  return accept({ board: board.value, ...(period === undefined ? {} : { period: period as LeaderboardPeriod }), ...(day.value === undefined ? {} : { day: day.value }), ...(limit === undefined ? {} : { limit: limit as number }) });
}

/** leaderboards.mine's params: optionally the day the periods are counted from. */
export function checkLeaderboardMine(value: unknown): ParamCheck<{ day?: string }> {
  const input = isPlainObject(value) ? value : {};
  const day = checkLeaderboardDay(input.day);
  if (!day.ok) return day;
  return accept(day.value === undefined ? {} : { day: day.value });
}

/** The longest leaderboards.submit body Tavora sends, in bytes; the service takes 32 KB. */
export const LEADERBOARD_SUBMIT_MAX_BYTES = 30_000;

/** What a board's declaration needs to be sent with a submit: the manifest's board, as far as its kind says. */
export interface LeaderboardDeclared {
  kind: string;
  daily?: boolean;
  order?: string;
  minGames?: number;
}

/** The board's declaration as the service reads it for a development copy (it uses the catalog's for the others). */
export function leaderboardDeclaration(board: LeaderboardDeclared): Record<string, string> {
  return {
    kind: board.kind,
    ...(board.kind === "streak" && board.daily ? { daily: "1" } : {}),
    ...((board.kind === "score" || board.kind === "average") && board.order === "low" ? { order: "low" } : {}),
    ...((board.kind === "average" || board.kind === "rate") && board.minGames !== undefined ? { minGames: String(board.minGames) } : {}),
  };
}

/** The local calendar day of a time, as YYYY-MM-DD (the same as local-day.ts: this file is loaded by Node as it is, so it imports nothing). */
function localDay(at: number): string {
  const date = new Date(at);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A result with only the fields results have; a result without a day belongs to the local day it ended on. */
export function leaderboardResultFields(value: unknown): Record<string, unknown> {
  const input = isPlainObject(value) ? value : {};
  const fields = Object.fromEntries(["id", "outcome", "value", "at", "day"].filter((key) => key in input).map((key) => [key, input[key]]));
  if (!("day" in fields) && typeof fields.at === "number" && Number.isFinite(fields.at)) fields.day = localDay(fields.at);
  return fields;
}

/** What leaderboards.submit sends the service for `board`: its declaration and each result's own fields. */
export function leaderboardSubmitBody(board: LeaderboardDeclared, results: readonly unknown[]): { board: Record<string, string>; results: Record<string, unknown>[] } {
  return { board: leaderboardDeclaration(board), results: results.map(leaderboardResultFields) };
}

/** Why a submit is too big for one call (its body, which depends on the board's kind, is over LEADERBOARD_SUBMIT_MAX_BYTES), or null. */
export function leaderboardSubmitProblem(board: LeaderboardDeclared, results: readonly unknown[]): string | null {
  const bytes = new TextEncoder().encode(JSON.stringify(leaderboardSubmitBody(board, results))).length;
  return bytes > LEADERBOARD_SUBMIT_MAX_BYTES ? "these results are too big for one call; send fewer at once" : null;
}

// ── Menus, tooltips and item-card skins ────────────────────────────────

/** Thrown inside the checks below; `refusing` turns it into their refusal. */
class Refusal {
  readonly message: string;
  constructor(message: string) {
    this.message = message;
  }
}
function refusing<T>(check: () => T): ParamCheck<T> {
  try {
    return accept(check());
  } catch (error) {
    if (error instanceof Refusal) return refuse(error.message);
    throw error;
  }
}
const invalid = (message: string): never => {
  throw new Refusal(message);
};

/** A menu as Tavora checked it, and the ids the user can pick: items that are not disabled, in submenus that are not disabled. */
export interface CheckedMenu {
  request: MenuRequest;
  choices: ReadonlySet<string>;
}

const MENU_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
/** A CSS colour without anything that could load or run: hex, a colour function of numbers, or transparent. */
const MENU_COLOR = /^(?:#[0-9a-f]{3,8}|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\([0-9.%\s,/+-]{1,60}\)|transparent)$/i;
/** What a reason may not hold: control characters, line and paragraph breaks, zero-width marks and the marks that reorder text. */
const MENU_NOT_PLAIN = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/;
/** Largest offset or size accepted for a menu's `at`, in CSS pixels. */
const MAX_MENU_COORDINATE = 100_000;

/**
 * ui.showMenu's params, rebuilt from known fields only: text stays text, colours are plain CSS colour values, at most
 * LIMITS.maxMenuEntries entries (submenus included), labels up to LIMITS.maxMenuLabel, hints up to LIMITS.maxMenuHint
 * and reasons up to LIMITS.maxMenuReason, on one line. A reason only goes with `disabled: true`.
 */
export function checkMenu(params: unknown): ParamCheck<CheckedMenu> {
  return refusing(() => {
    const record = (value: unknown, name: string): Record<string, unknown> => (isPlainObject(value) ? value : invalid(`${name} must be an object`));
    const only = (value: Record<string, unknown>, allowed: string[], name: string) => {
      const extra = Object.keys(value).filter((key) => !allowed.includes(key));
      if (extra.length > 0) invalid(`${name} has unknown fields: ${extra.join(", ")}`);
    };
    const text = (value: unknown, max: number, name: string): string =>
      typeof value !== "string" || value.trim() === "" || value.length > max ? invalid(`${name} must be text of 1 to ${max} characters`) : value;
    /** Text on one line, without line breaks, control characters or invisible marks that hide or reorder it. */
    const oneLine = (value: unknown, max: number, name: string): string =>
      typeof value === "string" && MENU_NOT_PLAIN.test(value) ? invalid(`${name} must be one line of plain text`) : text(value, max, name);
    const flag = (value: unknown, name: string): boolean | undefined => (value === undefined || typeof value === "boolean" ? value : invalid(`${name} must be true or false`));
    const color = (value: unknown, name: string): string | undefined =>
      value === undefined || (typeof value === "string" && MENU_COLOR.test(value)) ? value : invalid(`${name} must be a CSS colour such as #e5675a or oklch(0.7 0.17 150)`);
    const coordinate = (value: unknown, name: string, optional: boolean): number | undefined => {
      if (value === undefined && optional) return undefined;
      return typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > MAX_MENU_COORDINATE ? invalid(`${name} must be a number of CSS pixels`) : value;
    };
    /** Keeps a field off the result when it was left out, so the copy holds only what the module sent. */
    const defined = <R>(value: Record<string, unknown>): R => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as R;

    const raw = record(params, "params");
    only(raw, ["items", "at", "side", "align"], "params");
    const ids = new Set<string>();
    const choices = new Set<string>();
    let count = 0;
    const entries = (value: unknown, name: string, nested: boolean, enabled: boolean): MenuEntry[] => {
      if (!Array.isArray(value) || value.length === 0) invalid(`${name} must be a list of at least one entry`);
      return (value as unknown[]).map((item, index): MenuEntry => {
        if (++count > LIMITS.maxMenuEntries) invalid(`a menu has at most ${LIMITS.maxMenuEntries} entries`);
        const where = `${name}[${index}]`;
        const entry = record(item, where);
        switch (entry.type) {
          case "separator":
            only(entry, ["type"], where);
            return { type: "separator" };
          case "heading":
            only(entry, ["type", "label"], where);
            return { type: "heading", label: text(entry.label, LIMITS.maxMenuLabel, `${where}.label`) };
          case "item": {
            only(entry, ["type", "id", "label", "hint", "color", "checked", "radio", "disabled", "disabledReason", "danger"], where);
            if (typeof entry.id !== "string" || !MENU_ID.test(entry.id)) invalid(`${where}.id must be 1 to 64 letters, digits, ".", "_", ":" or "-"`);
            const id = entry.id as string;
            if (ids.has(id)) invalid(`${where}.id "${id}" is used twice`);
            ids.add(id);
            const disabled = flag(entry.disabled, `${where}.disabled`);
            if (enabled && !disabled) choices.add(id);
            const disabledReason = entry.disabledReason === undefined ? undefined : oneLine(entry.disabledReason, LIMITS.maxMenuReason, `${where}.disabledReason`);
            if (disabledReason !== undefined && !disabled) invalid(`${where}.disabledReason goes with disabled: true`);
            return defined<MenuEntry>({
              type: "item",
              id,
              label: text(entry.label, LIMITS.maxMenuLabel, `${where}.label`),
              hint: entry.hint === undefined ? undefined : text(entry.hint, LIMITS.maxMenuHint, `${where}.hint`),
              color: color(entry.color, `${where}.color`),
              checked: flag(entry.checked, `${where}.checked`),
              radio: flag(entry.radio, `${where}.radio`),
              disabled,
              disabledReason,
              danger: flag(entry.danger, `${where}.danger`),
            });
          }
          case "submenu": {
            if (nested) invalid(`${where}: a submenu holds no further submenus`);
            only(entry, ["type", "label", "color", "disabled", "items"], where);
            const disabled = flag(entry.disabled, `${where}.disabled`);
            return defined<MenuEntry>({
              type: "submenu",
              label: text(entry.label, LIMITS.maxMenuLabel, `${where}.label`),
              color: color(entry.color, `${where}.color`),
              disabled,
              items: entries(entry.items, `${where}.items`, true, enabled && !disabled),
            });
          }
          default:
            return invalid(`${where}.type must be "item", "separator", "heading" or "submenu"`);
        }
      });
    };

    const items = entries(raw.items, "params.items", false, true);
    const at = record(raw.at, "params.at");
    only(at, ["x", "y", "width", "height"], "params.at");
    const width = coordinate(at.width, "params.at.width", true);
    const height = coordinate(at.height, "params.at.height", true);
    if ((width !== undefined && width < 0) || (height !== undefined && height < 0)) invalid("params.at.width and height must not be negative");
    const side = raw.side;
    if (side !== undefined && side !== "bottom" && side !== "top" && side !== "right" && side !== "left") invalid('params.side must be "bottom", "top", "right" or "left"');
    const align = raw.align;
    if (align !== undefined && align !== "start" && align !== "center" && align !== "end") invalid('params.align must be "start", "center" or "end"');
    const request = defined<MenuRequest>({
      items,
      at: defined<MenuRequest["at"]>({ x: coordinate(at.x, "params.at.x", false)!, y: coordinate(at.y, "params.at.y", false)!, width, height }),
      side: side as MenuRequest["side"],
      align: align as MenuRequest["align"],
    });
    return { request, choices };
  });
}

/** An item-card skin's name (`ui.tooltip.defineSkin`, a tooltip's `skin`): 1 to 32 of a-z, 0-9 and -. */
export const TOOLTIP_SKIN_NAME = /^[a-z0-9-]{1,32}$/;
const TOOLTIP_ID = /^[a-zA-Z0-9._:-]{1,64}$/;
const TOOLTIP_HEX = /^#[0-9a-fA-F]{6}$/;
/**
 * A raster picture in the module's own bundle (`dist/…`): the item picture (PNG, JPEG, WebP or GIF), or a stat's icon,
 * which is a mask and so only PNG or WebP (a JPEG would be a filled square, a GIF would animate).
 */
const TOOLTIP_IMAGE_PATH = /^dist\/(?:[a-zA-Z0-9_. -]+\/)*[a-zA-Z0-9_. -]+\.(?:png|jpe?g|webp|gif)$/i;
const TOOLTIP_ICON_PATH = /\.(?:png|webp)$/i;
const TOOLTIP_INVALID = "invalid tooltip content";

const tooltipObject = (v: unknown, keys: string[]): Record<string, unknown> => {
  if (!isPlainObject(v) || Object.keys(v).some((k) => !keys.includes(k))) invalid(TOOLTIP_INVALID);
  return v as Record<string, unknown>;
};
const tooltipText = (v: unknown, max = 500): string => (typeof v !== "string" || !v.trim() || v.length > max ? invalid(TOOLTIP_INVALID) : v);
const tooltipList = <T>(v: unknown, limit: number, fn: (v: unknown) => T): T[] => (!Array.isArray(v) || v.length > limit ? invalid(TOOLTIP_INVALID) : v.map(fn));
const tooltipImage = (v: unknown, icon = false): string => {
  const image = tooltipText(v, 500);
  if (!TOOLTIP_IMAGE_PATH.test(image) || (icon && !TOOLTIP_ICON_PATH.test(image)) || image.split("/").includes("..")) invalid(TOOLTIP_INVALID);
  return image;
};
/** What a block's or the footer's text may not hold: control characters (but a line break where it may have one), zero-width marks and the marks that reorder text. */
const TOOLTIP_NOT_PLAIN = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/;
/** Plain text of 1 to `max` characters, with line breaks only where `breaks` says. */
const plainText = (v: unknown, max: number, breaks: boolean): string => {
  const text = tooltipText(v, max);
  return TOOLTIP_NOT_PLAIN.test(text) || (!breaks && text.includes("\n")) ? invalid(TOOLTIP_INVALID) : text;
};
/**
 * Runs of text, up to 40 and `max` characters in all, at least one not blank: each in the accent colour, bold or italic.
 * `plain` checks each run as `plainText` does (with line breaks where `breaks` says); the effect's runs aren't, as before.
 */
const tooltipRuns = (v: unknown, max: number, plain: boolean, breaks = true): TooltipEffectRun[] => {
  let length = 0;
  const runs = tooltipList(v, 40, (r) => {
    const run = tooltipObject(r, ["text", "accent", "strong", "italic"]);
    if (typeof run.text !== "string" || !run.text || (length += run.text.length) > max) invalid(TOOLTIP_INVALID);
    const text = run.text as string;
    if (plain && (TOOLTIP_NOT_PLAIN.test(text) || (!breaks && text.includes("\n")))) invalid(TOOLTIP_INVALID);
    for (const flag of [run.accent, run.strong, run.italic]) if (flag !== undefined && typeof flag !== "boolean") invalid(TOOLTIP_INVALID);
    return { text, ...(run.accent === true ? { accent: true } : {}), ...(run.strong === true ? { strong: true } : {}), ...(run.italic === true ? { italic: true } : {}) };
  });
  return runs.length && runs.some((r) => r.text.trim()) ? runs : invalid(TOOLTIP_INVALID);
};
/** A part after the sections (`blocks`): a paragraph, a heading, a list or tags, each by the limits in `TooltipBlock`. */
const tooltipBlock = (v: unknown): TooltipBlock => {
  const type = isPlainObject(v) ? v.type : undefined;
  if (type === "text") {
    const b = tooltipObject(v, ["type", "text", "runs", "tone", "size", "box"]);
    if ((b.text === undefined) === (b.runs === undefined)) invalid(TOOLTIP_INVALID);
    if (b.tone !== undefined && b.tone !== "default" && b.tone !== "muted") invalid(TOOLTIP_INVALID);
    if (b.size !== undefined && b.size !== "default" && b.size !== "small") invalid(TOOLTIP_INVALID);
    if (b.box !== undefined && typeof b.box !== "boolean") invalid(TOOLTIP_INVALID);
    return {
      type,
      ...(b.text === undefined ? { runs: tooltipRuns(b.runs, 1000, true) } : { text: plainText(b.text, 1000, true) }),
      ...(b.tone === "muted" ? { tone: "muted" as const } : {}),
      ...(b.size === "small" ? { size: "small" as const } : {}),
      ...(b.box === true ? { box: true } : {}),
    };
  }
  if (type === "heading") return { type, text: plainText(tooltipObject(v, ["type", "text"]).text, 100, false) };
  if (type === "list") {
    const items = tooltipList(tooltipObject(v, ["type", "items"]).items, 20, (item) => {
      if (typeof item === "string") return plainText(item, 300, false);
      const i = tooltipObject(item, ["text", "meta"]);
      return { text: plainText(i.text, 300, false), ...(i.meta === undefined ? {} : { meta: plainText(i.meta, 40, false) }) };
    });
    return items.length ? { type, items } : invalid(TOOLTIP_INVALID);
  }
  if (type === "tags") {
    const tags = tooltipList(tooltipObject(v, ["type", "tags"]).tags, 8, (tag) => {
      if (typeof tag === "string") return plainText(tag, 24, false);
      const t = tooltipObject(tag, ["text", "color"]);
      if (t.color !== undefined && (typeof t.color !== "string" || !TOOLTIP_HEX.test(t.color))) invalid(TOOLTIP_INVALID);
      return { text: plainText(t.text, 24, false), ...(t.color === undefined ? {} : { color: t.color as string }) };
    });
    return tags.length ? { type, tags } : invalid(TOOLTIP_INVALID);
  }
  return invalid(TOOLTIP_INVALID);
};
const tooltipIdOf = (v: unknown): string => {
  const id = tooltipText(tooltipObject(v, ["id"]).id, 64);
  return TOOLTIP_ID.test(id) ? id : invalid(TOOLTIP_INVALID);
};
const tooltipAnchorOf = (v: unknown): TooltipAnchor => {
  const o = tooltipObject(v, ["id", "at", "box"]);
  const id = tooltipIdOf({ id: o.id });
  const p = tooltipObject(o.at, ["x", "y"]);
  for (const n of [p.x, p.y]) if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 100000) invalid(TOOLTIP_INVALID);
  const anchor: TooltipAnchor = { id, at: { x: p.x as number, y: p.y as number } };
  // The anchor element's box: an element partly scrolled out of the panel has a negative x or y.
  if (o.box !== undefined) {
    const b = tooltipObject(o.box, ["x", "y", "width", "height"]);
    for (const n of [b.x, b.y, b.width, b.height]) if (typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > 100000) invalid(TOOLTIP_INVALID);
    anchor.box = { x: b.x as number, y: b.y as number, width: b.width as number, height: b.height as number };
  }
  return anchor;
};

/** ui.tooltip.hide's and ui.tooltip.close's params: `{ id }`, 1 to 64 letters, digits and `._:-`. */
export function checkTooltipId(params: unknown): ParamCheck<string> {
  return refusing(() => tooltipIdOf(params));
}

/** ui.tooltip.move's params: the tooltip's id, where it points (`at`) and the anchor element's box. */
export function checkTooltipAnchor(params: unknown): ParamCheck<TooltipAnchor> {
  return refusing(() => tooltipAnchorOf(params));
}

/** ui.tooltip.show's params: the anchor and the card's content, rebuilt from known fields only (40,000 characters at most as JSON). */
export function checkTooltip(params: unknown): ParamCheck<TooltipRequest> {
  return refusing(() => {
    const fail = (): never => invalid(TOOLTIP_INVALID);
    const o = tooltipObject(params, ["id", "at", "box", "content", "pinned", "pinnable"]);
    const anchor = tooltipAnchorOf({ id: o.id, at: o.at, ...(o.box === undefined ? {} : { box: o.box }) });
    if (o.pinned !== undefined && typeof o.pinned !== "boolean") fail();
    if (o.pinnable !== undefined && typeof o.pinnable !== "boolean") fail();
    // A card that says it can't be pinned never pins: asking for both is a mistake, not something to guess at.
    if (o.pinnable === false && o.pinned === true) fail();
    const c = tooltipObject(o.content, ["title", "subtitle", "look", "tone", "image", "layout", "effect", "skin", "badges", "artTags", "requirements", "properties", "perHeading", "columns", "sections", "corner", "icons", "pips", "blocks", "footer"]);
    const content: TooltipContent = { title: tooltipText(c.title, 200) };
    if (c.subtitle !== undefined) content.subtitle = tooltipText(c.subtitle, 300);
    if (c.look !== undefined) {
      if (!["neutral", "poe"].includes(c.look as string)) fail();
      content.look = c.look as NonNullable<TooltipContent["look"]>;
    }
    if (c.tone !== undefined) {
      if (!["normal", "magic", "rare", "unique"].includes(c.tone as string)) fail();
      content.tone = c.tone as NonNullable<TooltipContent["tone"]>;
    }
    if (c.image !== undefined) content.image = tooltipImage(c.image);
    if (c.layout !== undefined) {
      if (!["rich", "card", "unit"].includes(c.layout as string)) fail();
      content.layout = c.layout as NonNullable<TooltipContent["layout"]>;
    }
    // The card's effect text: one text, or up to 40 runs (in the accent colour, bold or italic), 1,000 characters in all.
    if (c.effect !== undefined) content.effect = typeof c.effect === "string" ? tooltipText(c.effect, 1000) : tooltipRuns(c.effect, 1000, false);
    if (c.skin !== undefined) {
      if (typeof c.skin !== "string" || !TOOLTIP_SKIN_NAME.test(c.skin)) fail();
      content.skin = c.skin as string;
    }
    if (c.badges !== undefined) content.badges = tooltipList(c.badges, 8, (v) => tooltipText(v, 100));
    // Up to 3 tags over the card's picture, each up to 24 characters, with an optional colour (#rrggbb only, as it goes
    // into a style on the page) and the bottom corner it sits in.
    if (c.artTags !== undefined) {
      content.artTags = tooltipList(c.artTags, 3, (v) => {
        const t = tooltipObject(v, ["text", "color", "side"]);
        if (t.color !== undefined && (typeof t.color !== "string" || !TOOLTIP_HEX.test(t.color))) fail();
        if (t.side !== undefined && t.side !== "left" && t.side !== "right") fail();
        return { text: tooltipText(t.text, 24), ...(t.color === undefined ? {} : { color: t.color as string }), ...(t.side === undefined ? {} : { side: t.side as "left" | "right" }) };
      });
      if (!content.artTags.length) fail();
    }
    const property = (v: unknown) => {
      const p = tooltipObject(v, ["label", "value"]);
      return { label: tooltipText(p.label, 100), value: tooltipText(p.value, 300) };
    };
    if (c.requirements !== undefined) content.requirements = tooltipList(c.requirements, 8, property);
    // A stat may grow by `per` (a third column on the card); with it, its value may be empty (it only grows). Its `icon`
    // is a picture in the module's bundle, by the same rules as `image`. The unit layout hangs a `suffix` past the value,
    // kept as given. Its `more` are up to 3 extra values after it, each up to 40 characters; an empty one leaves its
    // cell empty, and with one that isn't, the value may be empty too.
    const stat = (v: unknown) => {
      const p = tooltipObject(v, ["label", "value", "per", "icon", "suffix", "more"]);
      const more = p.more === undefined ? undefined : tooltipList(p.more, 3, (cell) => (typeof cell !== "string" || cell.length > 40 ? fail() : cell));
      if (more?.length === 0) fail();
      const filled = more?.some((cell) => cell.trim()) ?? false;
      if ((p.per !== undefined || filled) && (typeof p.value !== "string" || p.value.length > 300)) fail();
      const row: NonNullable<TooltipContent["properties"]>[number] = p.per === undefined && !filled ? property({ label: p.label, value: p.value }) : { label: tooltipText(p.label, 100), value: p.value as string };
      if (p.per !== undefined) row.per = tooltipText(p.per, 40);
      if (more) row.more = more;
      if (p.icon !== undefined) row.icon = tooltipImage(p.icon, true);
      if (p.suffix !== undefined) row.suffix = tooltipText(p.suffix, 40);
      return row;
    };
    if (c.properties !== undefined) content.properties = tooltipList(c.properties, 20, stat);
    if (c.perHeading !== undefined) content.perHeading = tooltipText(c.perHeading, 60);
    // The headings over the value column and each `more` column ("Lv 1", "Lv 2", …).
    if (c.columns !== undefined) {
      content.columns = tooltipList(c.columns, 4, (v) => tooltipText(v, 20));
      if (!content.columns.length) fail();
    }
    let rows = 0;
    if (c.sections !== undefined) {
      content.sections = tooltipList(c.sections, 12, (v) => {
        const s = tooltipObject(v, ["title", "rows"]);
        return {
          ...(s.title === undefined ? {} : { title: tooltipText(s.title, 100) }),
          rows: tooltipList(s.rows, 60, (v) => {
            if (++rows > 100) fail();
            const r = tooltipObject(v, ["text", "badges", "status", "connected"]);
            if (r.connected !== undefined && typeof r.connected !== "boolean") fail();
            return {
              text: tooltipText(r.text, 2000),
              ...(r.badges === undefined ? {} : { badges: tooltipList(r.badges, 5, (v) => tooltipText(v, 40)) }),
              ...(r.status === undefined ? {} : { status: tooltipText(r.status, 60) }),
              ...(r.connected === undefined ? {} : { connected: r.connected as boolean }),
            };
          }),
        };
      });
    }
    // The unit layout's corner value, icon row and pips. Their pictures are masks or small pictures in the bundle, by the
    // rules of a stat's icon.
    if (c.corner !== undefined) {
      const k = tooltipObject(c.corner, ["text", "icon"]);
      content.corner = { text: tooltipText(k.text, 20), ...(k.icon === undefined ? {} : { icon: tooltipImage(k.icon, true) }) };
    }
    if (c.icons !== undefined) {
      content.icons = tooltipList(c.icons, 12, (v) => {
        const i = tooltipObject(v, ["image", "label", "count"]);
        return { image: tooltipImage(i.image, true), label: tooltipText(i.label, 100), ...(i.count === undefined ? {} : { count: tooltipText(i.count, 8) }) };
      });
    }
    if (c.pips !== undefined) {
      const k = tooltipObject(c.pips, ["filled", "total", "extra"]);
      const whole = (n: unknown, max: number) => (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > max ? fail() : n);
      const total = whole(k.total, 10);
      if (total < 1) fail();
      content.pips = { filled: whole(k.filled, total), total, ...(k.extra === undefined ? {} : { extra: tooltipText(k.extra, 12) }) };
    }
    // Parts after the sections, as the kit's panel parts draw them, and a footer line. Their texts are plain: no control
    // characters (a paragraph keeps its line breaks), no invisible marks or marks that reorder text.
    if (c.blocks !== undefined) {
      content.blocks = tooltipList(c.blocks, 12, tooltipBlock);
      if (!content.blocks.length) fail();
    }
    if (c.footer !== undefined) content.footer = typeof c.footer === "string" ? plainText(c.footer, 300, false) : tooltipRuns(c.footer, 300, true, false);
    if (JSON.stringify(content).length > 40000) fail();
    return { ...anchor, content, pinned: o.pinned === true, ...(o.pinnable === false ? { pinnable: false } : {}) };
  });
}

/** The widest edge of a skin's frame picture, in its pixels (`frame.slice`). */
export const MAX_SKIN_SLICE = 64;
const SKIN_PATH = (ext: string) => new RegExp(`^dist\\/(?:[a-zA-Z0-9_. -]+\\/)*[a-zA-Z0-9_. -]+\\.(?:${ext})$`, "i");
const SKIN_FRAME_PATH = SKIN_PATH("png|webp");
const SKIN_FONT_PATH = SKIN_PATH("woff2");
/** The colours a skin may set. */
export const SKIN_COLOR_KEYS = ["surface", "text", "muted", "accent", "box", "boxText", "boxBorder", "bar"] as const;

/**
 * ui.tooltip.defineSkin's params: the skin's name, and its values with the right shapes. Whether its files are real
 * pictures and fonts and its colours readable is Tavora's to check.
 */
export function checkTooltipSkin(params: unknown): ParamCheck<{ name: string; skin: TooltipSkin }> {
  return refusing(() => {
    const no = (message: string): never => invalid(`ui.tooltip.defineSkin: ${message}`);
    const record = (v: unknown, keys: readonly string[], what: string): Record<string, unknown> => {
      if (!isPlainObject(v)) no(`${what} must be an object`);
      const o = v as Record<string, unknown>;
      const unknown = Object.keys(o).find((k) => !keys.includes(k));
      if (unknown !== undefined) no(`${what} has an unknown key "${unknown}"`);
      return o;
    };
    const bundlePath = (v: unknown, pattern: RegExp, what: string): string =>
      typeof v !== "string" || v.length > 500 || !pattern.test(v) || v.split("/").includes("..")
        ? no(`${what} must be a path in your own dist/ folder (${pattern === SKIN_FONT_PATH ? ".woff2" : ".png or .webp"})`)
        : v;
    const o = record(params, ["name", "skin"], "the request");
    if (typeof o.name !== "string" || !TOOLTIP_SKIN_NAME.test(o.name)) no("the name must be 1 to 32 of a-z, 0-9 and -");
    const s = record(o.skin, ["frame", "colors", "font", "pixelArt", "titleCaps"], "the skin");
    const skin: TooltipSkin = {};
    if (s.frame !== undefined) {
      const f = record(s.frame, ["image", "slice"], "frame");
      const slice = f.slice;
      if (!Array.isArray(slice) || slice.length !== 4 || !slice.every((n) => Number.isInteger(n) && n >= 0 && n <= MAX_SKIN_SLICE)) {
        no(`frame.slice must be four whole numbers from 0 to ${MAX_SKIN_SLICE} (top, right, bottom, left)`);
      }
      skin.frame = { image: bundlePath(f.image, SKIN_FRAME_PATH, "frame.image"), slice: [...(slice as number[])] as [number, number, number, number] };
    }
    if (s.colors !== undefined) {
      const c = record(s.colors, SKIN_COLOR_KEYS, "colors");
      const colors: NonNullable<TooltipSkin["colors"]> = {};
      for (const key of SKIN_COLOR_KEYS) {
        const value = c[key];
        if (value === undefined) continue;
        if (typeof value !== "string" || !TOOLTIP_HEX.test(value)) no(`colors.${key} must be a colour like #1a2b3c`);
        colors[key] = (value as string).toLowerCase();
      }
      skin.colors = colors;
    }
    if (s.font !== undefined) skin.font = bundlePath(s.font, SKIN_FONT_PATH, "font");
    for (const key of ["pixelArt", "titleCaps"] as const) {
      if (s[key] === undefined) continue;
      if (typeof s[key] !== "boolean") no(`${key} must be true or false`);
      skin[key] = s[key] as boolean;
    }
    return { name: o.name as string, skin };
  });
}

/**
 * An overlay page reads what the module published from this address next to it, as server-sent events: each
 * message is `{ "state": <JSON or null> }`, the first one straight away (see watchOverlay).
 */
export const OVERLAY_STATE_PATH = "_state";

/**
 * The interface font the user picked, as a stylesheet next to an overlay page: its files and `--tavora-font-sans`.
 * Newer Tavoras also send the font's id with every `_state` message (`{ "state": …, "font": "allo" }`), so a page can
 * load this again when it changes; watchOverlay does both by itself. An older Tavora has neither: use Inter then.
 */
export const OVERLAY_FONT_PATH = "_font.css";

/**
 * Tavora's own frames for an overlay page (over the game, on the Overlay page) load it with this query parameter set to
 * 1: such a frame keeps the size a `grows` source lists, times its scale. OBS, the preview window and older Tavoras
 * don't set it. Read it with `inTavoraFrame()`.
 */
export const OVERLAY_FRAME_PARAM = "tavoraFrame";

/**
 * In OBS an overlay page runs inside a frame of Tavora's own page, which keeps it from navigating away. The page tells
 * that frame its `color-scheme` with this message (`{ type, colorScheme }`, sent to its parent), and the frame takes the
 * same one: Chromium paints an opaque backdrop behind a frame whose scheme differs from the page's. `watchOverlay` sends
 * it by itself.
 */
export const OVERLAY_COLOR_SCHEME_MESSAGE = "tavora:overlay-color-scheme";

/**
 * The Custom CSS the user gave the Browser Source in OBS. OBS puts it into the top page, which is Tavora's frame page;
 * the frame page passes it on to the overlay page with this message (`{ type, css }`, from its parent), and
 * `watchOverlay` puts it into the page as a `<style>`, so it reaches the page as it did before the frame. It comes when
 * the page has said its colour scheme (OVERLAY_COLOR_SCHEME_MESSAGE) and again whenever it changes.
 */
export const OVERLAY_CSS_MESSAGE = "tavora:overlay-css";

/** The longest Custom CSS watchOverlay puts into the page, in characters. */
export const MAX_OVERLAY_CSS = 100_000;

/**
 * One entry of a menu drawn by Tavora (ui.showMenu). Text only; Tavora draws it in the current theme.
 * An item list where any item sets `checked` keeps a column for the mark, so labels line up.
 */
export type MenuEntry =
  | {
      type: "item";
      /** Returned when the user picks it; unique within the menu, at most 64 characters. */
      id: string;
      label: string;
      /** Small grey text on the right, such as a shortcut ("Ctrl+D"). */
      hint?: string;
      /** A colour dot before the label, as a CSS colour: `#rgb`, `#rrggbb`, `rgb()`, `hsl()`, `oklch()` and the like, or `transparent` for an empty ring. */
      color?: string;
      /** Shows a check mark (or a dot, with `radio`) when true, and keeps the mark's column when false. */
      checked?: boolean;
      /** The mark is a dot: one choice of several. */
      radio?: boolean;
      disabled?: boolean;
      /**
       * Why it is off, with `disabled: true`: a short sentence on one line, at most 120 characters ("Already used by
       * another line."). The entry stays reachable by the pointer and the arrow keys, shows the reason in its row where
       * the hint sits (instead of the hint, cut with "…" when long; screen readers get all of it), and can't be picked.
       * Without it a disabled entry is skipped. Needs
       * `sdk.supports("ui.showMenu.disabledReason")`: on an older Tavora the SDK shows it as the `hint` when the entry has
       * none (cut to 30 characters), and leaves it out otherwise.
       */
      disabledReason?: string;
      /** Red, for something that deletes or cannot be undone. */
      danger?: boolean;
    }
  | { type: "separator" }
  | { type: "heading"; label: string }
  | {
      type: "submenu";
      label: string;
      color?: string;
      disabled?: boolean;
      /** Items, separators and headings; a submenu holds no further submenus. */
      items: MenuEntry[];
    };

export type { TooltipContent, TooltipAnchor, TooltipRequest, TooltipSkin, TooltipEffectRun, TooltipTextRun, TooltipBlock, TooltipIcon, TooltipArtTag } from "./tooltip-types.js";
import type { TooltipContent, TooltipRequest, TooltipAnchor, TooltipSkin, TooltipEffectRun, TooltipBlock } from "./tooltip-types.js";

/** What ui.showMenu shows, and where. */
export interface MenuRequest {
  items: MenuEntry[];
  /**
   * Where, in the panel's CSS pixels from its top left corner: the rectangle of the element the menu is for
   * (a button, or the row that was right-clicked). The menu opens next to it, never on top of it; pass the
   * element's box for a context menu too, not the pointer. A bare point still works. Tavora keeps the menu inside
   * the window.
   */
  at: { x: number; y: number; width?: number; height?: number };
  /** Which side of `at` the menu opens on, when there is room. Default "bottom". */
  side?: "bottom" | "top" | "right" | "left";
  /** How the menu lines up with `at` along that side. Default "start". */
  align?: "start" | "center" | "end";
}

/** The kinds of picture a module can keep with blobs.put. */
export const PICTURE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export type PictureType = (typeof PICTURE_TYPES)[number];

/** The kinds of sound a module can keep with blobs.put (MP3, Ogg and WAV). Tavora 0.23.101 and newer. */
export const AUDIO_TYPES = ["audio/mpeg", "audio/ogg", "audio/wav"] as const;
export type AudioType = (typeof AUDIO_TYPES)[number];

/** The kinds of file a module can keep with blobs.put (pictures, PDFs and sounds), found by looking at the file itself. */
export const BLOB_TYPES = [...PICTURE_TYPES, "application/pdf", ...AUDIO_TYPES] as const;
export type BlobType = (typeof BLOB_TYPES)[number];

/** A stored file. */
export interface BlobInfo {
  /** 32 lowercase hex characters, chosen by the host. */
  id: string;
  bytes: number;
  type: BlobType;
  createdAt: string;
}

/** How much of the limits a module's files in the current workspace use. */
export interface BlobUsage {
  bytes: number;
  count: number;
  /** All files together. */
  maxBytes: number;
  /** One file. */
  maxFileBytes: number;
}

/**
 * Files are sent to and shown from the module's own address, not over the
 * bridge: POST /_blobs/ stores the request body and answers with a BlobInfo,
 * GET /_blobs/<id> serves a file. Both only work from the module's own page.
 */
export const BLOB_PATH = "/_blobs/";
/** The same for the module's files shared by every workspace (blobs.app). Tavora 0.23.101 and newer. */
export const APP_BLOB_PATH = "/_app-blobs/";
export const BLOB_ID = /^[a-f0-9]{32}$/;

/** POST a PNG here, from the module's own page, to put it on the clipboard (see clipboard.writeImage). */
export const CLIPBOARD_PATH = "/_clipboard/";

/**
 * POST a PNG here, from the module's own page, to save it as a file where the user picks in Tavora's save dialog
 * (see pictures.save). `?name=` suggests the file name; the answer is `{ fileName }`, the name it was saved under,
 * or `{ fileName: null }` when the user closed the dialog.
 */
export const PICTURES_PATH = "/_pictures/";

/** Document ids: host-generated UUIDs or module-chosen slugs. */
export const DOCUMENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³]) *(?:\..*)?$/i;

/**
 * Whether Windows keeps `name` for a device (CON, PRN, AUX, NUL, CONIN$, CONOUT$, COM0-9, LPT0-9, and COM and LPT with
 * a superscript ¹ ² ³), also with an extension or spaces after it (`NUL.txt`, `com1.x`, `CON .json`): Windows may open
 * the device for such a name instead of a file. Compared without regard to case. One rule for every name Tavora makes
 * or checks: document ids, folder names in manifests, file names in module zips, names of files a module saves
 * (`@tavora/module-schema` passes it on).
 */
export function isWindowsDeviceName(name: string): boolean {
  return WINDOWS_DEVICE.test(name);
}

/** The first Tavora that refuses the document ids `newDocumentIdProblem` names; an older one takes them. */
export const DOCUMENT_ID_RULE_TAVORA = "0.24.73";
/** The first Tavora that refuses `com0` and `lpt0` as document ids too; from `DOCUMENT_ID_RULE_TAVORA` up to it, they are taken. */
export const DOCUMENT_ID_ZERO_DEVICES_TAVORA = "0.24.103";

/**
 * Why `documents.put` refuses `id` for a new document, or null. Ids are saved as file names, so a new document can't be
 * called `index` (the store's own file) or a name Windows keeps for devices (`con`, `nul`, `com1`, …), in any case, and
 * can't differ from a saved document's id (`saved`) only by case, as Windows doesn't tell `Notes.json` from `notes.json`.
 * A document already saved under such an id stays readable and writable. Tavora `DOCUMENT_ID_RULE_TAVORA` and newer
 * (`com0` and `lpt0` from `DOCUMENT_ID_ZERO_DEVICES_TAVORA`); the memory host of `@tavora/sdk/testing` applies the same rule.
 */
export function newDocumentIdProblem(id: string, saved: Iterable<string>): string | null {
  if (id.toLowerCase() === "index" || isWindowsDeviceName(id)) return `"${id}" can't be a document id: Windows or Tavora keeps that name for itself`;
  const lower = id.toLowerCase();
  for (const other of saved) if (other.toLowerCase() === lower) return `document id "${id}" differs from "${other}" only by case`;
  return null;
}

/**
 * POST a JSON document here, from the module's own page, to save it as a file where the user picks in Tavora's save
 * dialog (see files.saveJson). `?name=` suggests the file name; the answer is `{ fileName }`, or `{ fileName: null }`
 * when the user closed the dialog.
 */
export const JSON_SAVE_PATH = "/_files/json/save/";

/**
 * POST here, from the module's own page, to open a JSON file the user picks in Tavora's open dialog (see
 * files.openJson). The answer is `{ fileName, value }`, or `null` when the user closed the dialog.
 */
export const JSON_OPEN_PATH = "/_files/json/open/";

/** POST a bounded JSON document after a gesture; saves it through the same save dialog as JSON_SAVE_PATH (older Tavora: a new .json in Downloads/Tavora). */
export const JSON_EXPORT_PATH = "/_exports/json/";

/** The kinds of file `files.save` and `files.open` handle: a CSV text file or an Excel workbook, nothing else. */
export type FileKind = "csv" | "xlsx";
export const FILE_KINDS: readonly FileKind[] = ["csv", "xlsx"];

/** The most a file for `files.save` or `files.open` may hold: 8 MiB, like a JSON file. */
export const MAX_FILE_BYTES = 8 * 1024 * 1024;

/**
 * POST the file's bytes here, from the module's own page, to save them as a .csv or .xlsx where the user picks in
 * Tavora's save dialog (see files.save). `?type=csv|xlsx` is required, `?name=` suggests the file name; the answer is
 * `{ fileName }`, or `{ fileName: null }` when the user closed the dialog.
 */
export const FILE_SAVE_PATH = "/_files/save/";

/**
 * POST here, from the module's own page, to open a .csv or .xlsx the user picks in Tavora's open dialog (see
 * files.open). `?types=csv,xlsx` says which are offered (both when left out). The answer is the file's bytes, with its
 * name and kind in the `X-Tavora-File-Name` (URI-encoded) and `X-Tavora-File-Kind` headers, or `null` (JSON) when the
 * user closed the dialog.
 */
export const FILE_OPEN_PATH = "/_files/open/";
/** The headers of FILE_OPEN_PATH's answer. */
export const FILE_NAME_HEADER = "X-Tavora-File-Name";
export const FILE_KIND_HEADER = "X-Tavora-File-Kind";

/** What `files.open` resolves with: a CSV as text, a workbook as bytes. */
export type OpenedFile = { fileName: string; type: "csv"; text: string } | { fileName: string; type: "xlsx"; bytes: Uint8Array };

/**
 * Calls the real client makes over plain HTTP from the module's own page, not over the message port. They answer
 * to the same rules as `Methods`, so they have an entry in `METHOD_INFO` too.
 */
export interface HttpCalls {
  "blobs.put": { params: { file: Blob }; result: BlobInfo };
  "blobs.app.put": { params: { file: Blob }; result: BlobInfo };
  "clipboard.writeImage": { params: { png: Blob }; result: null };
  "files.read": { params: { id: string }; result: Uint8Array };
  "folders.read": { params: { folder: string; path: string }; result: Uint8Array };
  "files.exportJson": { params: { value: JsonValue; name?: string }; result: { fileName: string } };
  "files.saveJson": { params: { value: JsonValue; name?: string }; result: { fileName: string } | null };
  "files.openJson": { params: undefined; result: { fileName: string; value: JsonValue } | null };
  "files.save": { params: { data: string | Uint8Array; type: FileKind; name?: string }; result: { fileName: string } | null };
  "files.open": { params: { types?: FileKind[] } | undefined; result: OpenedFile | null };
  "pictures.save": { params: { png: Blob; name?: string }; result: { fileName: string } | null };
}

/** Every call a module can make: the protocol's methods and the file, picture and blob calls. */
export type CallName = MethodName | keyof HttpCalls;

/** A call that needs a click or key press only for some params. */
export interface GestureRule {
  /** In words, for the reference: "opening", "pinned"... */
  when: string;
  check(params: unknown): boolean;
}

/** What the host knows about one call, besides its params and result. */
export interface MethodInfo {
  /** The first Tavora that answers it. Older ones throw UNKNOWN_METHOD (a page call: not found). `0.1.0` is "always". */
  since: string;
  /** The grant it needs, or null. Reserved methods are in `RESERVED_METHODS`, not here. */
  capability: Capability | null;
  /** Needs a click or key press in the panel just before: always (true), never (false) or for some params. */
  gesture: boolean | GestureRule;
  /** Set when the call is newer than `MIN_TAVORA`, so it does not raise it. */
  later?: true;
}

const call = (since: string, capability: Capability | null = null, gesture: boolean | GestureRule = false): MethodInfo => ({ since, capability, gesture });
/** A call newer than `MIN_TAVORA`: a module that uses it sets its own `minTavora`, or checks `sdk.supports`. */
const later = (since: string, capability: Capability | null = null, gesture: boolean | GestureRule = false): MethodInfo => ({ since, capability, gesture, later: true });
const flag = (key: string, when: string): GestureRule => ({ when, check: (params) => (params as Record<string, unknown> | undefined)?.[key] === true });

/**
 * Each call declared once: the Tavora that first has it, its capability and whether it needs a click. `Record<CallName,
 * ...>` makes a new method without an entry fail typecheck. The memory host, `sdk.supports`, the fallbacks and the
 * generated protocol reference all read this table; the host's own checks are in apps/desktop (bridge.ts, module-view.ts), and
 * apps/desktop/src/main/gesture-table.test.ts fails when the host's click checks and `gesture` differ.
 */
/**
 * The first Tavora with item cards and skins (`ui.tooltip.defineSkin`, and `layout`, `effect` and `skin` on a tooltip):
 * the one place that number is written. It must be the version the pull request merges as: set it right before merging,
 * then run `pnpm --filter @tavora/docs protocol`. Too low, and the SDK sends a Tavora without them keys it refuses.
 */
export const ITEM_CARD_TAVORA = "0.24.29";
/**
 * The first Tavora with a third stats column on item cards (`per` on a property and `perHeading` on a tooltip): the one
 * place that number is written. Set it to the version the pull request merges as, right before merging. Too low, and
 * the SDK sends a Tavora without it keys it refuses.
 */
export const ITEM_CARD_PER_TAVORA = "0.24.34";
/**
 * The first Tavora that takes `colors.boxBorder` in an item-card skin (the effect box's edge): the one place that
 * number is written. Set it to the version the pull request merges as, right before merging. Too low, and the SDK sends
 * an older Tavora a colour it doesn't know, which makes it refuse the whole skin.
 */
export const ITEM_CARD_BOX_BORDER_TAVORA = "0.24.35";
/**
 * The first Tavora that takes `icon` on an item card's stat (a small pictogram before its label): the one place that
 * number is written. Set it to the version the pull request merges as, right before merging. Too low, and the SDK sends
 * an older Tavora a key it refuses, and with it the whole tooltip.
 */
export const ITEM_CARD_ICON_TAVORA = "0.24.48";
/**
 * The first Tavora that takes `box` on `ui.tooltip.show` and `ui.tooltip.move` (the anchor element's box, so a hover
 * card shows while the pointer is anywhere over it): the one place that number is written. Set it to the version the
 * pull request merges as, right before merging. Too low, and the SDK sends an older Tavora a key it refuses, and with it
 * the whole tooltip.
 */
export const TOOLTIP_ANCHOR_BOX_TAVORA = "0.24.58";
/**
 * The first Tavora with the unit layout (`layout: "unit"`, with `corner`, `icons` and `pips` on a tooltip, `suffix` on
 * a property and `colors.bar` in a skin): the one place that number is written. Set it to the version the pull request
 * merges as, right before merging. Too low, and the SDK sends an older Tavora keys it refuses, and with them the whole
 * tooltip or skin.
 */
export const UNIT_CARD_TAVORA = "0.24.127";
/**
 * The first Tavora with extra value columns on item cards (`more` on a property and `columns` on a tooltip): the one
 * place that number is written. Set it to the version the pull request merges as, right before merging. Too low, and
 * the SDK sends an older Tavora keys it refuses, and with them the whole tooltip.
 */
export const ITEM_CARD_COLUMNS_TAVORA = "0.24.148";
/**
 * The first Tavora with tags over an item card's picture (`artTags` on a tooltip): the one place that number is written.
 * Set it to the version the pull request merges as, right before merging. Too low, and the SDK sends an older Tavora a
 * key it refuses, and with it the whole tooltip.
 */
export const ITEM_CARD_ART_TAGS_TAVORA = "0.24.149";
/**
 * The first Tavora that takes `disabledReason` on a menu item (`ui.showMenu`): the one place that number is written. Set
 * it to the version the pull request merges as, right before merging. Too low, and the SDK sends an older Tavora a key
 * it refuses, and with it the whole menu.
 */
export const MENU_DISABLED_REASON_TAVORA = "0.25.68";
/**
 * The first Tavora with formatting in the shared tooltip (`strong` and `italic` on a run, `blocks` and `footer` on a
 * tooltip): the one place that number is written. Set it to the version the pull request merges as, right before
 * merging. Too low, and the SDK sends an older Tavora keys it refuses, and with them the whole tooltip.
 */
export const TOOLTIP_FORMATTING_TAVORA = "0.25.72";
/**
 * The first Tavora that tells a panel whether it is over the game (`panel.isOverGame` and the `panel.overGame` event):
 * the one place that number is written. Set it to the version the pull request merges as, right before merging, then
 * run `pnpm --filter @tavora/docs protocol`. Too low, and a module asks an older Tavora, which answers UNKNOWN_METHOD.
 */
export const PANEL_OVER_GAME_TAVORA = "0.24.90";
/**
 * The first Tavora that sends the design style with the theme (`TavoraTheme.style`): the one place that number is
 * written. Set it to the version the pull request merges as, right before merging, then run
 * `pnpm --filter @tavora/docs protocol`. An older Tavora leaves `style` out, which means Classic.
 */
export const STYLE_TAVORA = "0.24.110";
/**
 * The first Tavora that sends how the user reaches tabs that don't fit (`TavoraTheme.tabOverflow`): the one place that
 * number is written. Set it to the version the pull request merges as, right before merging, then run
 * `pnpm --filter @tavora/docs protocol`. An older Tavora leaves it out, which means `"list"`.
 */
export const TAB_OVERFLOW_TAVORA = "0.24.135";

export const METHOD_INFO: Readonly<Record<CallName, MethodInfo>> = {
  "bridge.handshake": call("0.1.0"),
  "workspace.getCurrent": call("0.21.43"),
  "storage.get": call("0.1.0"),
  "storage.set": call("0.1.0"),
  "storage.delete": call("0.1.0"),
  "storage.keys": call("0.1.0"),
  "storage.compareAndSet": later("0.21.92"),
  "storage.app.get": call("0.16.10"),
  "storage.app.set": call("0.16.10"),
  "storage.app.delete": call("0.16.10"),
  "storage.app.keys": call("0.16.10"),
  "storage.app.compareAndSet": later("0.21.92"),
  "documents.list": call("0.1.0"),
  "documents.get": call("0.1.0"),
  "documents.put": call("0.1.0"),
  "documents.delete": call("0.1.0"),
  "panel.getState": call("0.1.0"),
  "panel.setState": call("0.1.0"),
  "panel.getLaunch": call("0.17.17"),
  "panel.setContent": call("0.17.17"),
  "panel.navigated": call("0.17.18"),
  "panel.isMaximized": call("0.20.20"),
  "panel.setMaximized": call("0.20.20", null, flag("maximized", "making it fill the workspace")),
  "panel.isOverGame": later(PANEL_OVER_GAME_TAVORA),
  "panel.setDialog": later("0.21.95", null, flag("open", "opening")),
  "panel.setDialogTitle": later("0.23.71"),
  "panel.setLive": call("0.21.11"),
  "panels.open": call("0.17.18", null, true),
  "panels.openMany": later("0.23.29", null, true),
  "workspace.getViewport": call("0.1.0"),
  "ui.getTheme": call("0.1.0"),
  "ui.getLanguage": call("0.5.9"),
  "ui.showMenu": call("0.17.9", null, true),
  "ui.tooltip.show": call("0.18.18", null, flag("pinned", "pinned")),
  "ui.tooltip.move": call("0.18.18"),
  "ui.tooltip.hide": call("0.18.18"),
  "ui.tooltip.close": call("0.18.18"),
  "ui.tooltip.defineSkin": later(ITEM_CARD_TAVORA),
  "links.open": call("0.11.0", null, true),
  "blobs.list": call("0.12.0"),
  "blobs.usage": call("0.12.0"),
  "blobs.delete": call("0.12.0"),
  "blobs.app.list": later("0.23.101"),
  "blobs.app.usage": later("0.23.101"),
  "blobs.app.delete": later("0.23.101"),
  "network.fetch": call("0.16.8", "network"),
  "network.readPage": call("0.19.3", "network"),
  "aiUsage.accounts": call("0.16.10", "aiUsage"),
  "aiUsage.read": call("0.16.10", "aiUsage"),
  "leaderboards.status": later("0.21.92", "leaderboards"),
  "leaderboards.show": later("0.21.92", "leaderboards", true),
  "leaderboards.hide": later("0.21.92", "leaderboards", true),
  "leaderboards.submit": later("0.21.92", "leaderboards"),
  "leaderboards.top": later("0.21.92", "leaderboards"),
  "leaderboards.mine": later("0.21.97", "leaderboards"),
  "systemInfo.info": call("0.21.1", "systemInfo"),
  "systemInfo.watch": call("0.21.1", "systemInfo"),
  "systemInfo.connectionLog": call("0.21.22", "systemInfo"),
  "systemInfo.clearConnectionLog": call("0.21.22", "systemInfo", true),
  "systemInfo.connectionSettings": call("0.21.22", "systemInfo"),
  "systemInfo.setConnectionSettings": call("0.21.22", "systemInfo", true),
  "systemInfo.apps": call("0.21.21", "systemInfo"),
  "systemInfo.traffic": call("0.21.31", "systemInfo"),
  "media.watch": call("0.21.18", "media"),
  "media.control": call("0.21.18", "media", true),
  "discord.state": call("0.16.11", "discord"),
  "discord.connect": call("0.16.11", "discord", true),
  "discord.allowControl": call("0.16.11", "discord", true),
  "discord.command": call("0.16.11", "discord", {
    when: "SELECT_VOICE_CHANNEL or SET_VOICE_SETTINGS",
    check: (params) => {
      const command = (params as { command?: string } | undefined)?.command;
      return command === "SELECT_VOICE_CHANNEL" || command === "SET_VOICE_SETTINGS";
    },
  }),
  "discord.subscribe": call("0.16.11", "discord"),
  "discord.unsubscribe": call("0.16.11", "discord"),
  "discord.image": call("0.16.11", "discord"),
  "overlay.publish": call("0.19.26"),
  "overlay.remove": call("0.19.26"),
  "overlay.copyLink": call("0.19.26", "overlay", true),
  "overlay.resetLink": call("0.19.26", "overlay"),
  "overlay.showOverGame": call("0.20.51", null, true),
  "overlay.hideOverGame": call("0.21.3"),
  "overlay.overGame": call("0.21.3"),
  "overlay.setSources": later("0.23.43"),
  "overlay.preview": call("0.21.3", null, true),
  "overlay.openPage": later("0.23.77", null, true),
  "hotkeys.list": call("0.19.26"),
  "hotkeys.set": call("0.19.26", null, true),
  "hotkeys.remove": call("0.19.26"),
  "blobs.put": call("0.12.0"),
  "blobs.app.put": later("0.23.101"),
  "clipboard.writeImage": call("0.14.1", null, true),
  "clipboard.writeText": later("0.25.23", null, true),
  "files.pickReadOnly": call("0.21.13", null, true),
  "files.forget": call("0.21.13"),
  "files.check": later("0.23.6"),
  "files.showInFolder": later("0.23.6", null, true),
  "files.read": call("0.21.13"),
  "folders.state": later("0.23.113", "folders"),
  "folders.list": later("0.23.113", "folders"),
  "folders.watch": later("0.23.113", "folders"),
  "folders.choose": later("0.23.113", "folders", true),
  "folders.showInFolder": later("0.23.116", "folders", true),
  "folders.read": later("0.23.113", "folders"),
  "files.exportJson": call("0.19.17", null, true),
  "files.saveJson": call("0.21.13", null, true),
  "files.openJson": call("0.21.13", null, true),
  "files.save": later("0.23.102", null, true),
  "files.open": later("0.23.102", null, true),
  "pictures.save": call("0.17.19", null, true),
};

function versionParts(version: string): number[] {
  return version.split(".").map((part) => Number.parseInt(part, 10) || 0);
}

/** Whether `version` is `wanted` or newer (dotted numbers). */
export function versionAtLeast(version: string, wanted: string): boolean {
  const a = versionParts(version);
  const b = versionParts(wanted);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return true;
}

/** Whether a call needs a click or key press, for these params. */
export function needsGesture(method: CallName, params?: unknown): boolean {
  const { gesture } = METHOD_INFO[method];
  return typeof gesture === "boolean" ? gesture : gesture.check(params);
}

/** Things besides calls that a Tavora needs for the SDK to work, and the first Tavora that has them. */
export const HOST_FEATURES: Readonly<Record<string, string>> = {
  "permissions.onRequest": "0.19.32",
};

/** The oldest Tavora that has everything the SDK offers without a check: the newest of the calls not marked `later` and of `HOST_FEATURES`. */
export const MIN_TAVORA: string = [...Object.values(METHOD_INFO).filter((info) => !info.later).map((info) => info.since), ...Object.values(HOST_FEATURES)].reduce((a, b) => (versionAtLeast(a, b) ? a : b));

/** SDK calls whose protocol call has another name. */
const SDK_CALLS = { "panel.openDialog": "panel.setDialog", "panel.closeDialog": "panel.setDialog" } as const;

/**
 * Params of an existing call that only a newer Tavora knows. An older one rejects the unknown key (INVALID_PARAMS) for the
 * whole call, so the SDK leaves the key out there. They never raise `MIN_TAVORA`.
 */
export const FIELD_SINCE = { "ui.tooltip.pinnable": "0.23.91", "ui.tooltip.skin": ITEM_CARD_TAVORA, "ui.tooltip.per": ITEM_CARD_PER_TAVORA, "ui.tooltip.boxBorder": ITEM_CARD_BOX_BORDER_TAVORA, "ui.tooltip.propertyIcon": ITEM_CARD_ICON_TAVORA, "ui.tooltip.anchorBox": TOOLTIP_ANCHOR_BOX_TAVORA, "ui.tooltip.unit": UNIT_CARD_TAVORA, "ui.tooltip.columns": ITEM_CARD_COLUMNS_TAVORA, "ui.tooltip.artTags": ITEM_CARD_ART_TAGS_TAVORA, "ui.showMenu.disabledReason": MENU_DISABLED_REASON_TAVORA, "ui.tooltip.formatting": TOOLTIP_FORMATTING_TAVORA } as const;

/** A protocol call, a param only newer Tavoras know (`ui.tooltip.pinnable`), or one of the SDK calls named differently on the wire (`panel.openDialog`). */
export type SupportedCall = CallName | keyof typeof SDK_CALLS | keyof typeof FIELD_SINCE;

/** Whether a Tavora of this version answers the call. */
export function supportsCall(version: string, call: SupportedCall): boolean {
  if (call in FIELD_SINCE) return versionAtLeast(version, FIELD_SINCE[call as keyof typeof FIELD_SINCE]);
  const method = call in SDK_CALLS ? SDK_CALLS[call as keyof typeof SDK_CALLS] : (call as CallName);
  return versionAtLeast(version, METHOD_INFO[method].since);
}
