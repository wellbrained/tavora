// The shapes the API answers with (apps/api/src/admin-app.ts and admin-panel.ts).

export interface WaitingKind {
  id: string;
  label: string;
  count: number;
  section: string;
  tab?: string;
}

export interface Summary {
  waiting: WaitingKind[];
  numbers: { hostedIcons: number; modules: number; listedModules: number; installs: number; accounts: number | null; catalogBytes: number };
}

export interface PendingIcon {
  sha256: string;
  gameName?: string;
  name?: string;
  hasIcon: boolean;
  custom?: boolean;
}

export interface HostedIcon {
  id: string;
  names: string[];
  sha256: string;
  origin: string;
}

export interface Overview {
  pending: PendingIcon[];
  hosted: HostedIcon[];
}

export interface ModuleReport {
  sha256: string;
  id: string;
  name: string;
  version: string;
  count: number;
  listed: boolean;
}

export interface Reports {
  reports: ModuleReport[];
  catalogFullSince: string | null;
}

export interface ReviewReport {
  count: number;
  review: { id: string; moduleName: string; stars: number; text: string; version: string; hidden: boolean; author: string | null; reply: string | null };
}

export interface KeyRequest {
  old: string;
  new: string;
  account: string;
  email: string | null;
  developer: string | null;
  leaked: boolean;
  requestedAt: string;
  newLinkedAt: string | null;
  status: string;
}

export interface Updates {
  feed: { version: string; releasedAt: string | null; installerSize: number | null } | null;
  versions: { version: string; date: string; title: string; notes: string[]; state: "on-feed" | "waiting" | "earlier" | "unknown" }[];
}

export interface CatalogModule {
  id: string;
  name: string;
  owner: string;
  publisher: string | null;
  listed: boolean;
  createdAt: string;
  installs: number;
  storedBytes: number;
  versions: { version: string; publishedAt: string; size: number; zipKept: boolean }[];
}

export interface Modules {
  modules: CatalogModule[];
  storedBytes: number;
  limitBytes: number;
  fullSince: string | null;
}

export type Accounts = { on: false } | { on: true; total: number; perDay: { day: string; count: number }[]; active7: number; active30: number };

export interface Status {
  api: { ok: boolean; games: number; builtAt: string | null };
  mail: { day: string; sent: number; limit: number | null } | null;
  backup: { at: string | null };
  catalog: { storedBytes: number; limitBytes: number; fullSince: string | null };
  sites: { name: string; ok: boolean; status: number | null }[];
  packages: { name: string; npm: string | null; main: string | null; mainAhead: boolean }[];
}

export type StatKind = "app-installer" | "app-update" | "module-install" | "module-update";

/** GET /api/stats: plain daily totals, oldest day first. */
export interface Stats {
  from: string;
  to: string;
  days: string[];
  counts: Record<StatKind, Record<string, number[]>>;
  totals: Record<StatKind, Record<string, number>>;
  accounts: ({ total: number; active7: number; active30: number } | null)[];
}

export interface ReviewReason {
  check: string;
  text: string;
  detail?: string;
}

export type DeclineReason = "unsafe" | "hateful" | "adult" | "spam" | "broken";

/** GET /api/moderation/waiting: one version waiting for review, with what helps judge it. */
export interface WaitingVersion {
  sha256: string;
  id: string;
  name: string;
  version: string;
  size: number;
  queuedAt: string;
  previousVersion: string | null;
  reasons: ReviewReason[];
  developer: {
    accountId: string | null;
    name: string | null;
    email: string | null;
    banned: boolean;
    approvedBefore: boolean;
    keys: string[];
    prefixes: string[];
    modules: string[];
  };
  module: {
    description: string | null;
    homepage: string | null;
    support: string | null;
    games: unknown;
    permissions: { network: string[]; connectors: string[] };
    notes: string[];
    readme: string | null;
    pictures: { sha256: string; type: string; size: number; kind: "icon" | "screenshot" }[];
    files: { name: string; size: number }[];
  };
}

export interface Ban {
  accountId: string;
  reason: string;
  note: string | null;
  bannedAt: string;
  modules: string[];
  email: string | null;
  name: string | null;
}

export interface LiveCheck {
  ranAt: string;
  checked: number;
  skipped: number;
  flagged: number;
  results: { id: string; version: string; name: string; owner: string; developer: string | null; reasons: ReviewReason[]; error?: string }[];
}
