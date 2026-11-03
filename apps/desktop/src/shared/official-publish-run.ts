import type { OfficialBuildStep, OfficialPublishPreview, OfficialPublishRun, OfficialPublishStep, OfficialUploadStep } from "./host-api";
import type { MessageKey } from "./i18n";
import { assertNever } from "./assert-never";

// The publish of a built-in module as one union (OfficialPublishRun): how the main process moves it from phase to phase
// (host.ts), and what the dialog shows for each phase (OfficialPublishDialog.vue).

export const BUILD_STEPS: readonly OfficialBuildStep[] = ["fetch", "check", "worktree", "install", "build", "pack"];
export const UPLOAD_STEPS: readonly OfficialUploadStep[] = ["sign", "upload"];

const isBuildStep = (step: OfficialPublishStep): step is OfficialBuildStep => (BUILD_STEPS as readonly string[]).includes(step);

/** A new run: the build starts with fetching origin/main. */
export function startRun(moduleId: string, name: string): OfficialPublishRun {
  return { phase: "building", moduleId, name, step: "fetch" };
}

/** The build is packed: its preview waits for Sign and upload. */
export function previewRun(run: OfficialPublishRun, preview: OfficialPublishPreview): OfficialPublishRun {
  return { phase: "preview", moduleId: run.moduleId, name: run.name, preview };
}

/** Sign and upload pressed: the key is loaded or picked. Only from the preview. */
export function confirmRun(run: OfficialPublishRun): OfficialPublishRun {
  return run.phase === "preview" ? { ...run, phase: "confirming" } : run;
}

/** Back to the preview: no key was picked, or the key was refused and another one can be tried. */
export function backToPreview(run: OfficialPublishRun): OfficialPublishRun {
  switch (run.phase) {
    case "building":
    case "preview":
      return run;
    case "confirming":
    case "uploading":
      return { phase: "preview", moduleId: run.moduleId, name: run.name, preview: run.preview };
    default:
      return assertNever(run);
  }
}

/**
 * A step the publisher reports. A build step counts only while building and an upload step only once Sign and upload
 * was pressed; any other report (a late one after a cancel) changes nothing.
 */
export function stepRun(run: OfficialPublishRun, step: OfficialPublishStep): OfficialPublishRun {
  switch (run.phase) {
    case "building":
      return isBuildStep(step) ? { ...run, step } : run;
    case "preview":
      return run;
    case "confirming":
    case "uploading":
      return isBuildStep(step) ? run : { phase: "uploading", moduleId: run.moduleId, name: run.name, preview: run.preview, step };
    default:
      return assertNever(run);
  }
}

/** Cancel can still stop it: while building or at the preview, not once Sign and upload was pressed. */
export function canCancel(run: OfficialPublishRun): boolean {
  switch (run.phase) {
    case "building":
    case "preview":
      return true;
    case "confirming":
    case "uploading":
      return false;
    default:
      return assertNever(run);
  }
}

export interface RunDisplay {
  /** The preview to show, or null while building. */
  preview: OfficialPublishPreview | null;
  /** The steps are shown (building, signing, uploading) instead of the preview. */
  showSteps: boolean;
  /** Signing or uploading: nothing can be cancelled then. */
  uploading: boolean;
  steps: { step: OfficialPublishStep; state: "done" | "now" | "todo" }[];
  title: { key: MessageKey; params: Record<string, string> };
}

function stepList(list: readonly OfficialPublishStep[], at: OfficialPublishStep | null): RunDisplay["steps"] {
  const index = at === null ? -1 : list.indexOf(at);
  return list.map((step, i) => ({ step, state: i < index ? "done" : i === index ? "now" : "todo" }));
}

/** What the publish dialog shows for each phase. */
export function runDisplay(run: OfficialPublishRun): RunDisplay {
  switch (run.phase) {
    case "building":
      return { preview: null, showSteps: true, uploading: false, steps: stepList(BUILD_STEPS, run.step), title: { key: "officialPublish.dialog.title", params: { name: run.name } } };
    case "preview":
    case "confirming":
      return {
        preview: run.preview,
        showSteps: false,
        uploading: false,
        steps: stepList(UPLOAD_STEPS, null),
        title: { key: "officialPublish.preview.title", params: { name: run.preview.name, version: run.preview.version } },
      };
    case "uploading":
      return { preview: run.preview, showSteps: true, uploading: true, steps: stepList(UPLOAD_STEPS, run.step), title: { key: "officialPublish.dialog.title", params: { name: run.name } } };
    default:
      return assertNever(run);
  }
}
