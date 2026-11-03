import { describe, expect, it } from "vitest";
import type { OfficialPublishCheck, OfficialPublishPreview, OfficialPublishRun, OfficialPublishStep } from "../shared/host-api";
import { BUILD_STEPS, officialDialog, officialSettings, UPLOAD_STEPS } from "./official-publish";

const preview: OfficialPublishPreview = {
  id: "tavora.notes",
  name: "Notes",
  version: "0.7.0",
  shipped: "0.6.1",
  listed: "0.6.1",
  commit: "a".repeat(40),
  release: "v0.23.0",
  minTavora: "0.23.0",
  notes: [],
  files: [],
  size: 0,
};
const base = { moduleId: "tavora.notes", name: "Notes from the list" };

/** Every run the host can send. */
const RUNS: OfficialPublishRun[] = [
  { phase: "idle" },
  ...BUILD_STEPS.map((step) => ({ phase: "building" as const, ...base, step })),
  { phase: "preview", ...base, preview },
  { phase: "confirming", ...base, preview },
  ...UPLOAD_STEPS.map((step) => ({ phase: "uploading" as const, ...base, preview, step })),
];

// How the host sent the run before it was one union, and what the dialog and Settings made of it then.
type OldRun = { moduleId: string; name: string; step: OfficialPublishStep; preview: OfficialPublishPreview | null } | null;

function oldRun(run: OfficialPublishRun): OldRun {
  switch (run.phase) {
    case "idle":
      return null;
    case "building":
      return { ...base, step: run.step, preview: null };
    // The preview showed at step "pack", also while Sign and upload loaded the key (the host's own flag then).
    case "preview":
    case "confirming":
      return { ...base, step: "pack", preview: run.preview };
    case "uploading":
      return { ...base, step: run.step, preview: run.preview };
  }
}

function oldDialog(run: OldRun) {
  if (!run) return { open: false };
  const preview = run.preview;
  const uploading = preview !== null && (["sign", "upload"] as OfficialPublishStep[]).includes(run.step);
  const list: OfficialPublishStep[] = preview ? ["sign", "upload"] : ["fetch", "check", "worktree", "install", "build", "pack"];
  const at = list.indexOf(run.step);
  const steps = list.map((step, index) => ({ step, state: index < at ? "done" : index === at ? "now" : "todo" }));
  return {
    open: true,
    title: preview && !uploading ? { preview: preview.name, version: preview.version } : { name: run.name },
    stepsShown: !preview || uploading,
    steps: !preview || uploading ? steps : null,
    hint: !preview,
    cancelDisabled: uploading,
  };
}

function newDialog(run: OfficialPublishRun) {
  const shown = officialDialog(run);
  if (shown.show === "none") return { open: false };
  return {
    open: true,
    title: shown.show === "preview" ? { preview: shown.preview.name, version: shown.preview.version } : { name: shown.name },
    stepsShown: shown.show === "steps",
    steps: shown.show === "steps" ? shown.steps : null,
    hint: shown.show === "steps" && shown.hint,
    cancelDisabled: shown.show === "steps" && !shown.canCancel,
  };
}

describe("the official Publish dialog", () => {
  it.each(RUNS.map((run) => [run.phase + ("step" in run ? `:${run.step}` : ""), run] as const))("shows the same as before for %s", (_name, run) => {
    expect(newDialog(run)).toEqual(oldDialog(oldRun(run)));
  });

  it("marks the step running now, the ones before it done", () => {
    expect(officialDialog({ phase: "building", ...base, step: "install" })).toMatchObject({
      show: "steps",
      steps: [
        { step: "fetch", state: "done" },
        { step: "check", state: "done" },
        { step: "worktree", state: "done" },
        { step: "install", state: "now" },
        { step: "build", state: "todo" },
        { step: "pack", state: "todo" },
      ],
    });
    expect(officialDialog({ phase: "confirming", ...base, preview })).toEqual({ show: "preview", preview, confirming: true });
  });
});

describe("Settings > Development's Built-in modules", () => {
  const CHECKS: OfficialPublishCheck[] = [{ phase: "idle" }, { phase: "checking" }, { phase: "failed", error: "No network." }];

  it.each(CHECKS.flatMap((check) => RUNS.map((run) => [check.phase, run.phase + ("step" in run ? `:${run.step}` : ""), check, run] as const)))(
    "shows the same as before while the check is %s and the run %s",
    (_check, _run, check, run) => {
      const old = oldRun(run);
      const checking = check.phase === "checking";
      const checkError = check.phase === "failed" ? check.error : null;
      expect(officialSettings({ check, run })).toEqual({
        checking,
        error: checkError,
        refreshDisabled: checking || (old !== null && !old.preview),
        publishDisabled: old !== null || checking,
        forgetKeyDisabled: old !== null,
      });
    },
  );
});
