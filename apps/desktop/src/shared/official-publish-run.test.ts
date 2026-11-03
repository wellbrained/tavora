import { describe, expect, it } from "vitest";
import type { OfficialPublishPreview, OfficialPublishRun, OfficialPublishStep } from "./host-api";
import { backToPreview, BUILD_STEPS, canCancel, confirmRun, previewRun, runDisplay, startRun, stepRun, UPLOAD_STEPS } from "./official-publish-run";

const PREVIEW: OfficialPublishPreview = {
  id: "tavora.notes",
  name: "Notes",
  version: "0.7.0",
  shipped: "0.6.1",
  listed: "0.6.1",
  commit: "a".repeat(40),
  release: "v0.23.0",
  minTavora: "0.23.0",
  notes: ["Faster search."],
  files: [{ name: "tavora.module.json", size: 10 }],
  size: 10,
};

const building = (step: (typeof BUILD_STEPS)[number]): OfficialPublishRun => ({ phase: "building", moduleId: "tavora.notes", name: "Notes", step });
const preview: OfficialPublishRun = { phase: "preview", moduleId: "tavora.notes", name: "Notes", preview: PREVIEW };
const confirming: OfficialPublishRun = { phase: "confirming", moduleId: "tavora.notes", name: "Notes", preview: PREVIEW };
const uploading = (step: (typeof UPLOAD_STEPS)[number]): OfficialPublishRun => ({ phase: "uploading", moduleId: "tavora.notes", name: "Notes", preview: PREVIEW, step });

const EVERY_PHASE: OfficialPublishRun[] = [...BUILD_STEPS.map(building), preview, confirming, ...UPLOAD_STEPS.map(uploading)];

describe("the publish run's phases", () => {
  it("goes building → preview → confirming → uploading, each step in its own phase", () => {
    let run = startRun("tavora.notes", "Notes");
    expect(run).toEqual(building("fetch"));
    for (const step of BUILD_STEPS) {
      run = stepRun(run, step);
      expect(run).toEqual(building(step));
    }
    run = previewRun(run, PREVIEW);
    expect(run).toEqual(preview);
    run = confirmRun(run);
    expect(run).toEqual(confirming);
    run = stepRun(run, "sign");
    expect(run).toEqual(uploading("sign"));
    run = stepRun(run, "upload");
    expect(run).toEqual(uploading("upload"));
  });

  it("ignores a step that doesn't belong to the phase, such as a late report after a cancel", () => {
    expect(stepRun(building("build"), "sign")).toEqual(building("build"));
    expect(stepRun(preview, "upload")).toBe(preview);
    expect(stepRun(preview, "build")).toBe(preview);
    expect(stepRun(confirming, "pack")).toBe(confirming);
    expect(stepRun(uploading("upload"), "install")).toEqual(uploading("upload"));
  });

  it("confirms only from the preview", () => {
    expect(confirmRun(building("install"))).toEqual(building("install"));
    expect(confirmRun(confirming)).toBe(confirming);
    expect(confirmRun(uploading("sign"))).toEqual(uploading("sign"));
  });

  it("can be cancelled while building and at the preview, not once Sign and upload was pressed", () => {
    for (const step of BUILD_STEPS) expect(canCancel(building(step))).toBe(true);
    expect(canCancel(preview)).toBe(true);
    expect(canCancel(confirming)).toBe(false);
    for (const step of UPLOAD_STEPS) expect(canCancel(uploading(step))).toBe(false);
  });

  it("goes back to the preview when no key was picked or the key was refused, at signing or at uploading", () => {
    expect(backToPreview(confirming)).toEqual(preview);
    expect(backToPreview(uploading("sign"))).toEqual(preview);
    expect(backToPreview(uploading("upload"))).toEqual(preview);
    // Nothing to go back to while building; the preview stays the preview.
    expect(backToPreview(building("build"))).toEqual(building("build"));
    expect(backToPreview(preview)).toBe(preview);
  });
});

/**
 * The dialog as it was before the run became a union (OfficialPublishDialog.vue, its old computeds), over the old shape:
 * every phase must look the same now.
 */
function oldDisplay(run: { name: string; step: OfficialPublishStep; preview: OfficialPublishPreview | null }) {
  const OLD_BUILD: OfficialPublishStep[] = ["fetch", "check", "worktree", "install", "build", "pack"];
  const OLD_UPLOAD: OfficialPublishStep[] = ["sign", "upload"];
  const previewShown = run.preview;
  const isUploading = previewShown !== null && OLD_UPLOAD.includes(run.step);
  const list = previewShown ? OLD_UPLOAD : OLD_BUILD;
  const at = list.indexOf(run.step);
  return {
    preview: previewShown,
    showSteps: !previewShown || isUploading,
    uploading: isUploading,
    steps: list.map((step, index) => ({ step, state: index < at ? "done" : index === at ? "now" : "todo" })),
    title: previewShown && !isUploading ? { key: "officialPublish.preview.title", params: { name: previewShown.name, version: previewShown.version } } : { key: "officialPublish.dialog.title", params: { name: run.name } },
  };
}

/** The old shape of each phase: the step, and the preview once built (Sign and upload pressed looked like the preview, at "pack"). */
function oldShape(run: OfficialPublishRun) {
  switch (run.phase) {
    case "building":
      return { name: run.name, step: run.step, preview: null };
    case "preview":
    case "confirming":
      return { name: run.name, step: "pack" as const, preview: run.preview };
    case "uploading":
      return { name: run.name, step: run.step, preview: run.preview };
  }
}

describe("what the publish dialog shows", () => {
  it.each(EVERY_PHASE.map((run) => [run.phase === "building" || run.phase === "uploading" ? `${run.phase} (${run.step})` : run.phase, run] as const))("shows the same as before while %s", (_name, run) => {
    expect(runDisplay(run)).toEqual(oldDisplay(oldShape(run)));
  });

  it("marks the current step and the ones done", () => {
    expect(runDisplay(building("install")).steps.map((item) => item.state)).toEqual(["done", "done", "done", "now", "todo", "todo"]);
    expect(runDisplay(uploading("upload")).steps.map((item) => item.state)).toEqual(["done", "now"]);
    expect(runDisplay(preview).steps.map((item) => item.state)).toEqual(["todo", "todo"]);
  });
});
