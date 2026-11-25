import { apiReason, LEADERBOARD_PERIODS, type ApiReason, type LeaderboardBoard } from "@tavora/module-schema";
import { checkLeaderboardMine, checkLeaderboardSubmit, leaderboardDeclaration, leaderboardSubmitBody, leaderboardSubmitProblem, checkLeaderboardTop, type LeaderboardMine, type ParamCheck, type LeaderboardPeriod, type LeaderboardRow, type LeaderboardStanding, type LeaderboardStatus, type LeaderboardSubmitResult, type LeaderboardTop } from "@tavora/sdk/protocol";
import { HostError } from "./errors";
import { isRecord } from "../shared/is-record";

// The leaderboards connector (decided 2026-10-28, apps/api/src/leaderboards.ts has the service's side). A module
// asks; Tavora's main process talks to the service with the user's sign-in, which never reaches the module, and
// gives the module only names, numbers and a `self` mark on the user's own line. Before a module's results go
// public Tavora asks the user itself, in the module's panel (show); the module can't answer or skip that.
//
// Five board kinds (streak, score, total, average, rate), each readable for a period (day, week, month, year, all).
// `top` gives the lines of one board and period, `mine` the user's own standing on every board in every period. A
// result counts for the periods its `day` is in; one sent without a `day` gets the local day of its `at`.

/** Module ids the service runs test boards for, which only their developer sees. */
const TEST_PREFIX = "local.";

/**
 * The id a module's boards go by on the service. Only a module installed from the catalog (or one of Tavora's own) uses
 * its own id. Any other copy, from a development folder or a zip, gets test boards (`local.` and its id without the
 * publisher part), whatever its manifest or key says, so it can never reach the boards of the module it claims to be.
 */
export function boardsModuleId(moduleId: string, fromCatalog: boolean): string {
  if (fromCatalog || moduleId.startsWith(TEST_PREFIX)) return moduleId;
  return `${TEST_PREFIX}${moduleId.split(".").slice(1).join(".")}`;
}

/** The parts of AccountClient the leaderboards use. */
export interface LeaderboardAccount {
  /** Whether this Tavora has accounts at all (a development build may run without the service). */
  enabled(): boolean;
  isSignedIn(): boolean;
  leaderboardRequest(method: "GET" | "PUT" | "POST" | "DELETE", path: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }>;
}

/** What Tavora asks in the panel: whether to show the user's name and results, or, signed out, whether to sign in. */
export type LeaderboardQuestion = { kind: "consent"; name: string } | { kind: "sign-in" };

export interface ModuleLeaderboardsOptions {
  /** The id its boards go by (boardsModuleId). */
  moduleId: string;
  /** The boards of the module's manifest. */
  boards: readonly LeaderboardBoard[];
  account: LeaderboardAccount;
  /** The neutral name for a label, in Tavora's language: "User · K7" (just "User" without one). */
  pseudonym(label: string): string;
  /** Asks the user in the module's panel; resolves with their answer. */
  ask(question: LeaderboardQuestion): Promise<boolean>;
}

type Answer = { status: number; body: Record<string, unknown> };

/** While accounts are off there is no service to reach. */
const NO_SERVICE: LeaderboardStatus = { online: false, signedIn: false, available: false, shown: false, name: null };

const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/** One standing as the module gets it: the rank, the size of the board and the numbers of the board's kind; null where there is none. */
function standing(value: unknown, kind: LeaderboardBoard["kind"]): LeaderboardStanding | null {
  if (!isRecord(value)) return null;
  const numbers: Partial<LeaderboardStanding> =
    kind === "streak" ? { current: count(value.current), best: count(value.best) }
    : kind === "score" ? { value: count(value.value) }
    : kind === "rate" ? { value: count(value.value), games: count(value.games), wins: count(value.wins) }
    : { value: count(value.value), games: count(value.games) };
  return { rank: count(value.rank), of: count(value.of), ...numbers };
}

const emptyPeriods = (): Record<LeaderboardPeriod, LeaderboardStanding | null> => ({ day: null, week: null, month: null, year: null, all: null });

/** The reasons the service gives a result it did not take. */
const REJECTED_REASONS: readonly ApiReason[] = ["invalid", "time", "archive", "day-taken", "full"];

/** Turns the service's refusal into the module's error. */
function refused(answer: Answer | null): never {
  const reason = apiReason(answer?.body);
  if (!answer) throw new HostError("PERMISSION_DENIED", "leaderboards need Tavora's accounts, which are off in this Tavora");
  if (answer.status === 401) throw new HostError("PERMISSION_DENIED", "the user is signed out of Tavora");
  if (answer.status === 403 && reason === "not-shown") throw new HostError("PERMISSION_DENIED", "the user hasn't agreed to show their results yet (leaderboards.show)");
  if (answer.status === 403) throw new HostError("PERMISSION_DENIED", "this module's leaderboards aren't on Tavora's service yet");
  if (answer.status === 404 && reason === "unknown-board") throw new HostError("PERMISSION_DENIED", "this board isn't live on Tavora's service yet");
  if (answer.status === 400) throw new HostError("INVALID_PARAMS", "Tavora's service refused the request");
  if (answer.status === 429) throw new HostError("NETWORK_ERROR", "too many leaderboard requests; try again in a minute");
  throw new HostError("NETWORK_ERROR", "Tavora's service can't take leaderboard requests right now");
}

/** One module's leaderboards, as its panels use them. */
export class ModuleLeaderboards {
  constructor(private readonly options: ModuleLeaderboardsOptions) {}

  async status(): Promise<LeaderboardStatus> {
    return (await this.read()).status;
  }

  /** Asks the user in the panel, then shows them on the boards if they agree; signed out, offers to sign in. Offline, asks nothing. */
  async show(): Promise<LeaderboardStatus> {
    const { status: before, name } = await this.read();
    if (!before.online) return before;
    if (!before.signedIn) {
      if (this.options.account.enabled()) await this.options.ask({ kind: "sign-in" });
      return before;
    }
    if (!before.available || before.shown) return before;
    if (!(await this.options.ask({ kind: "consent", name: name ?? this.options.pseudonym("") }))) return before;
    const answer = await this.request("PUT", "/shown");
    if (answer?.status !== 200) refused(answer);
    return this.statusOf(answer.body);
  }

  /** Takes the user off the boards; the service deletes their results for this module. */
  async hide(): Promise<LeaderboardStatus> {
    if (!this.options.account.isSignedIn()) return this.status();
    const answer = await this.request("DELETE", "/shown");
    if (answer?.status !== 200) refused(answer);
    return this.statusOf(answer.body);
  }

  async submit(params: unknown): Promise<LeaderboardSubmitResult> {
    const checked = this.checked(checkLeaderboardSubmit(params, this.boardIds()));
    const board = this.board(checked.board);
    const { results } = checked;
    // Only the fields a result has go on to the service; it checks each of them (the SDK's memory host checks the size the same way).
    const tooBig = leaderboardSubmitProblem(board, results);
    if (tooBig) throw new HostError("INVALID_PARAMS", tooBig);
    const body = leaderboardSubmitBody(board, results);
    if (!this.options.account.isSignedIn()) refused({ status: 401, body: {} });
    const answer = await this.request("POST", `/boards/${board.id}`, body);
    if (answer?.status !== 200) refused(answer);
    const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
    const rejected = Array.isArray(answer.body.rejected) ? answer.body.rejected.filter(isRecord) : [];
    return {
      accepted: strings(answer.body.accepted),
      rejected: rejected.flatMap((item) =>
        typeof item.id === "string" && REJECTED_REASONS.includes(item.reason as ApiReason)
          ? [{ id: item.id, reason: item.reason as LeaderboardSubmitResult["rejected"][number]["reason"] }]
          : [],
      ),
    };
  }

  async top(params: unknown): Promise<LeaderboardTop> {
    const input = this.checked(checkLeaderboardTop(params, this.boardIds()));
    const board = this.board(input.board);
    const query = new URLSearchParams({ ...leaderboardDeclaration(board), ...(input.period === undefined ? {} : { period: input.period }), ...(input.day === undefined ? {} : { day: input.day }), ...(input.limit === undefined ? {} : { limit: String(input.limit) }) });
    const answer = await this.request("GET", `/boards/${board.id}?${query}`);
    if (!answer) return { rows: [] };
    if (answer.status !== 200) refused(answer);
    const rows = Array.isArray(answer.body.rows) ? answer.body.rows.filter(isRecord) : [];
    return { rows: rows.map((row): LeaderboardRow => ({
      ...(standing(row, board.kind) as LeaderboardStanding),
      name: typeof row.name === "string" ? row.name : this.options.pseudonym(typeof row.label === "string" ? row.label : ""),
      self: row.self === true,
    })) };
  }

  /** The user's own standing on every board of the manifest, in every period. Signed out, or with accounts off, there is none. */
  async mine(params: unknown): Promise<LeaderboardMine> {
    const input = this.checked(checkLeaderboardMine(params));
    const { boards, account, moduleId } = this.options;
    const none = () => ({ boards: boards.map((board) => ({ id: board.id, name: board.name, periods: emptyPeriods() })) });
    if (!account.enabled() || !account.isSignedIn()) return none();
    const query = new URLSearchParams({
      ...(input.day === undefined ? {} : { day: input.day }),
      // A development copy has no boards on the service, so it says which it has.
      ...(moduleId.startsWith(TEST_PREFIX) ? { boards: JSON.stringify(boards.map((board) => ({ id: board.id, ...leaderboardDeclaration(board) }))) } : {}),
    });
    const answer = await this.request("GET", `/mine${query.toString() ? `?${query}` : ""}`);
    if (!answer) return none();
    if (answer.status !== 200) refused(answer);
    const listed = Array.isArray(answer.body.boards) ? answer.body.boards.filter(isRecord) : [];
    return {
      boards: boards.map((board) => {
        const periods = emptyPeriods();
        const found = listed.find((item) => item.id === board.id);
        const given = found && isRecord(found.periods) ? found.periods : {};
        for (const period of LEADERBOARD_PERIODS) periods[period] = standing(given[period], board.kind);
        return { id: board.id, name: board.name, periods };
      }),
    };
  }

  /** The params as the SDK's shared check (`@tavora/sdk/protocol`, the memory host's too) took them, or its refusal. */
  private checked<T>(result: ParamCheck<T>): T {
    if (!result.ok) throw new HostError(result.code, result.message);
    return result.value;
  }

  private boardIds(): string[] {
    return this.options.boards.map((board) => board.id);
  }

  /** A board of the manifest by its id, which the shared check found there. */
  private board(id: string): LeaderboardBoard {
    return this.options.boards.find((item) => item.id === id)!;
  }

  /**
   * The status, and the name the boards would show, which only Tavora's own question shows before the user agreed.
   * Offline (or the service busy or failing) is a status too, never an error: the module asks again later.
   */
  private async read(again = true): Promise<{ status: LeaderboardStatus; name: string | null }> {
    const offline = { status: { online: false, signedIn: this.options.account.isSignedIn(), available: false, shown: false, name: null }, name: null };
    let answer: Answer | null;
    try {
      answer = await this.request("GET", "");
    } catch {
      return offline;
    }
    if (!answer) return { status: { ...NO_SERVICE }, name: null };
    // A sign-in the service no longer knows was forgotten just now: ask again as signed out.
    if (answer.status === 401 && again && !this.options.account.isSignedIn()) return this.read(false);
    if (answer.status === 429 || answer.status >= 500) return offline;
    if (answer.status !== 200) refused(answer);
    return { status: this.statusOf(answer.body), name: this.nameOf(answer.body) };
  }

  /** The status for the module: the user's name only once it is public anyway. */
  private statusOf(body: Record<string, unknown>): LeaderboardStatus {
    const signedIn = this.options.account.isSignedIn();
    const shown = signedIn && body.shown === true;
    return { online: true, signedIn, available: body.available === true, shown, name: shown ? this.nameOf(body) : null };
  }

  private nameOf(body: Record<string, unknown>): string | null {
    return typeof body.name === "string" ? body.name : typeof body.label === "string" ? this.options.pseudonym(body.label) : null;
  }

  /** One request about this module; null while accounts are off. Can't reach the service: NETWORK_ERROR. */
  private async request(method: "GET" | "PUT" | "POST" | "DELETE", path: string, body?: unknown): Promise<Answer | null> {
    if (!this.options.account.enabled()) return null;
    try {
      return await this.options.account.leaderboardRequest(method, `/${this.options.moduleId}${path}`, body);
    } catch {
      throw new HostError("NETWORK_ERROR", "can't reach Tavora's service");
    }
  }
}
