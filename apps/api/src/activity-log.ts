import { DatabaseSync } from "node:sqlite";

/**
 * What the maintainer did in the admin (decided 2026-10-27): every change a POST to /api/* made, with what it touched, the
 * reason and note typed for it, and a few numbers from the answer (was the developer mailed). Admin only; nothing about a
 * player is kept beyond the account the action was about. Kept in `activity.sqlite` of the state directory, newest first.
 */

export interface ActivityTarget {
  /** What was touched: account, module, version, review, icon. */
  type: string;
  id: string;
  /** A name a person recognises: the module's, the profile's, the version's. */
  label: string | null;
}

export interface ActivityEntry {
  id: number;
  at: string;
  /** The route that did it, without /api/: catalog/listed, accounts/suspend, moderation/approve. */
  kind: string;
  target: ActivityTarget | null;
  reason: string | null;
  note: string | null;
  /** The few fields of the request and the answer worth keeping (listed, mailed, signedOut). */
  detail: Record<string, string | number | boolean>;
}

export interface ActivityQuery {
  limit?: number;
  /** Only entries older than this id, for the next page. */
  before?: number;
  /** One route, or one area (accounts, moderation) when it has no slash. */
  kind?: string;
  /** Part of a label, id, reason or note, case ignored. */
  q?: string;
}

const MAX_PAGE = 200;

export class ActivityLog {
  private readonly db: DatabaseSync;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec(`
      create table if not exists activity (
        id integer primary key autoincrement, at integer not null, kind text not null,
        target_type text, target_id text, target_label text, reason text, note text, detail text not null default '{}'
      );
      create index if not exists activity_kind on activity (kind, id);
    `);
  }

  close(): void {
    this.db.close();
  }

  record(entry: { at: number; kind: string; target: ActivityTarget | null; reason?: string | null; note?: string | null; detail?: Record<string, string | number | boolean> }): void {
    this.db
      .prepare("insert into activity (at, kind, target_type, target_id, target_label, reason, note, detail) values (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(entry.at, entry.kind, entry.target?.type ?? null, entry.target?.id ?? null, entry.target?.label ?? null, entry.reason ?? null, entry.note ?? null, JSON.stringify(entry.detail ?? {}));
  }

  /** Newest first. `hasMore` says whether an older page exists. */
  list({ limit = 50, before, kind, q }: ActivityQuery = {}): { entries: ActivityEntry[]; hasMore: boolean } {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (before !== undefined) (where.push("id < ?"), args.push(before));
    if (kind) {
      if (kind.includes("/")) (where.push("kind = ?"), args.push(kind));
      else (where.push("kind like ?"), args.push(`${kind.replace(/[%_]/g, "")}/%`));
    }
    const text = q?.trim().toLowerCase();
    if (text) {
      const like = `%${text.replace(/[%_]/g, "")}%`;
      where.push("(lower(coalesce(target_label, '')) like ? or lower(coalesce(target_id, '')) like ? or lower(coalesce(reason, '')) like ? or lower(coalesce(note, '')) like ? or lower(kind) like ?)");
      args.push(like, like, like, like, like);
    }
    const size = Math.max(1, Math.min(MAX_PAGE, Math.floor(limit)));
    const rows = this.db
      .prepare(`select id, at, kind, target_type, target_id, target_label, reason, note, detail from activity ${where.length ? `where ${where.join(" and ")}` : ""} order by id desc limit ?`)
      .all(...args, size + 1) as unknown as { id: number; at: number; kind: string; target_type: string | null; target_id: string | null; target_label: string | null; reason: string | null; note: string | null; detail: string }[];
    return {
      entries: rows.slice(0, size).map((row) => ({
        id: row.id,
        at: new Date(row.at).toISOString(),
        kind: row.kind,
        target: row.target_type && row.target_id ? { type: row.target_type, id: row.target_id, label: row.target_label } : null,
        reason: row.reason,
        note: row.note,
        detail: JSON.parse(row.detail) as ActivityEntry["detail"],
      })),
      hasMore: rows.length > size,
    };
  }
}
