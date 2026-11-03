// What the host window shows of a built-in module's publish (main/official-publish.ts) in each phase of the run:
// OfficialPublishDialog.vue and Settings > Development's Built-in modules list.
import { assertNever } from "../shared/assert-never";
import type { OfficialBuildStep, OfficialPublishPreview, OfficialPublishRun, OfficialPublishStep, OfficialPublishView, OfficialUploadStep } from "../shared/host-api";

export const BUILD_STEPS: readonly OfficialBuildStep[] = ["fetch", "check", "worktree", "install", "build", "pack"];
export const UPLOAD_STEPS: readonly OfficialUploadStep[] = ["sign", "upload"];

export type StepState = "done" | "now" | "todo";

/**
 * The dialog: nothing; the steps with the current one marked (building, or signing and uploading, which can't be
 * cancelled); or the preview of what Sign and upload sends (`confirming` once it was pressed).
 */
export type OfficialDialog =
  | { show: "none" }
  | { show: "steps"; name: string; steps: { step: OfficialPublishStep; state: StepState }[]; hint: boolean; canCancel: boolean }
  | { show: "preview"; preview: OfficialPublishPreview; confirming: boolean };

function marked<T extends OfficialPublishStep>(list: readonly T[], now: T): { step: T; state: StepState }[] {
  const at = list.indexOf(now);
  return list.map((step, index) => ({ step, state: index < at ? "done" : index === at ? "now" : "todo" }));
}

export function officialDialog(run: OfficialPublishRun): OfficialDialog {
  switch (run.phase) {
    case "idle":
      return { show: "none" };
    case "building":
      return { show: "steps", name: run.name, steps: marked(BUILD_STEPS, run.step), hint: true, canCancel: true };
    case "preview":
    case "confirming":
      return { show: "preview", preview: run.preview, confirming: run.phase === "confirming" };
    case "uploading":
      return { show: "steps", name: run.name, steps: marked(UPLOAD_STEPS, run.step), hint: false, canCancel: false };
    default:
      return assertNever(run);
  }
}

/** The Built-in modules list: what is being worked out, and which buttons wait for the run. */
export function officialSettings(view: Pick<OfficialPublishView, "check" | "run">): {
  checking: boolean;
  error: string | null;
  refreshDisabled: boolean;
  publishDisabled: boolean;
  forgetKeyDisabled: boolean;
} {
  const checking = view.check.phase === "checking";
  const running = view.run.phase !== "idle";
  return {
    checking,
    error: view.check.phase === "failed" ? view.check.error : null,
    // A check can't run while a build does: both fetch in the same checkout.
    refreshDisabled: checking || view.run.phase === "building",
    publishDisabled: running || checking,
    forgetKeyDisabled: running,
  };
}
