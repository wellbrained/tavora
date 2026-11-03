import type { CloudCopyView } from "../shared/host-api";
import { assertNever } from "../shared/assert-never";

// The cloud copy's state as unions (cloud-copy-sync.ts), so no two flags can disagree: what it is doing right now, what
// it waits on the user for, and how far the window's close has come. Settings still gets the flat view (CloudCopyView);
// the functions here are the only place that turns one into the other.

/** Bytes read and sent of what changed. */
export type CopyProgress = { done: number; total: number };

/** What the copy is doing right now; one thing at a time (CopySync.exclusive). */
export type CopyActivity = { phase: "idle" } | { phase: "checking" } | { phase: "downloading" } | { phase: "uploading"; progress: CopyProgress | null };

export type CopyWork = Exclude<CopyActivity["phase"], "idle">;

/**
 * What syncing waits on the user for, or null: the recovery key of a copy another PC made (`key`), which side to keep
 * when both changed (`conflict`), or a restart that takes a newer copy (`restart`).
 */
export type CopyQuestion = "key" | "conflict" | "restart" | null;

/**
 * The window's close: `open` until it is asked to close; `holding` while the last upload runs (`shown` once the user
 * sees it); `closed` once it may go on (the upload ended, the user closed anyway, or Tavora restarts).
 */
export type CopyClose = { phase: "open" } | { phase: "holding"; shown: boolean } | { phase: "closed" };

export const IDLE: CopyActivity = { phase: "idle" };

export function begin(work: CopyWork): CopyActivity {
  switch (work) {
    case "checking":
    case "downloading":
      return { phase: work };
    case "uploading":
      return { phase: "uploading", progress: null };
    default:
      return assertNever(work);
  }
}

/** Progress counts only while uploading; anything else (a late report after the upload ended) changes nothing. */
export function progressed(activity: CopyActivity, progress: CopyProgress): CopyActivity {
  return activity.phase === "uploading" ? { phase: "uploading", progress } : activity;
}

export function activityView(activity: CopyActivity): Pick<CloudCopyView, "busy" | "progress"> {
  switch (activity.phase) {
    case "idle":
      return { busy: null, progress: null };
    case "checking":
    case "downloading":
      return { busy: activity.phase, progress: null };
    case "uploading":
      return { busy: "uploading", progress: activity.progress };
    default:
      return assertNever(activity);
  }
}

/** A new question. The keep-which-side question outranks a restart: the restart would take a copy the user hasn't chosen. */
export function ask(current: CopyQuestion, next: Exclude<CopyQuestion, null>): CopyQuestion {
  return next === "restart" && current === "conflict" ? current : next;
}

export function questionView(question: CopyQuestion): Pick<CloudCopyView, "askKey" | "conflict" | "restartToTake"> {
  switch (question) {
    case null:
      return { askKey: false, conflict: false, restartToTake: false };
    case "key":
      return { askKey: true, conflict: false, restartToTake: false };
    case "conflict":
      return { askKey: false, conflict: true, restartToTake: false };
    case "restart":
      return { askKey: false, conflict: false, restartToTake: true };
    default:
      return assertNever(question);
  }
}

/** The user sees the close waiting; only while it still waits (a close that went on stays closed). */
export function closeShown(close: CopyClose): CopyClose {
  return close.phase === "holding" ? { phase: "holding", shown: true } : close;
}

export function closeView(close: CopyClose): Pick<CloudCopyView, "closing"> {
  switch (close.phase) {
    case "open":
    case "closed":
      return { closing: false };
    case "holding":
      return { closing: close.shown };
    default:
      return assertNever(close);
  }
}
