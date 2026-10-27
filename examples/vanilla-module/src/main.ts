import { connect, TavoraError, type TavoraSDK, type TavoraTheme } from "@tavora/sdk";

// Every example module shows the same things with the same data-testid
// values, so one set of end-to-end tests covers all of them.

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.querySelector<T>(`[data-testid="${id}"]`)!;

interface Note {
  text: string;
}
type View = "list" | "grid";

function applyTheme(theme: TavoraTheme) {
  el("theme").textContent = theme.mode;
  const style = document.documentElement.style;
  style.setProperty("--bg", theme.colors.background);
  style.setProperty("--text", theme.colors.text);
  style.setProperty("--muted", theme.colors.textMuted);
  style.setProperty("--accent", theme.colors.accent);
}

/** Settings: a click counter kept with storage.get/set. */
async function setUpCounter(tavora: TavoraSDK) {
  let count = (await tavora.storage.get<number>("count")) ?? 0;
  el("count").textContent = String(count);
  const button = el<HTMLButtonElement>("increment");
  button.addEventListener("click", async () => {
    count += 1;
    el("count").textContent = String(count);
    await tavora.storage.set("count", count);
  });
  button.disabled = false;
}

/** A document shared by every panel of this module, saved with a revision check. */
async function setUpNote(tavora: TavoraSDK) {
  const textarea = el<HTMLTextAreaElement>("note");
  let revision = 0;

  async function load() {
    const note = await tavora.documents.get<Note>("note");
    revision = note?.revision ?? 0;
    textarea.value = note?.data.text ?? "";
    el("note-revision").textContent = String(revision);
  }

  await load();
  tavora.documents.onChange(async (change) => {
    if (change.id !== "note") return;
    await load();
    el("note-status").textContent = "Updated in another panel";
  });

  const save = el<HTMLButtonElement>("save-note");
  save.addEventListener("click", async () => {
    try {
      const saved = await tavora.documents.put({
        id: "note",
        title: "Note",
        data: { text: textarea.value },
        ifRevision: revision,
      });
      revision = saved.revision;
      el("note-revision").textContent = String(revision);
      el("note-status").textContent = "Saved";
    } catch (error) {
      if (!(error instanceof TavoraError) || error.code !== "CONFLICT") throw error;
      // Someone else saved first: show their version instead of overwriting it.
      await load();
      el("note-status").textContent = "Changed elsewhere; reloaded";
    }
  });
  textarea.disabled = false;
  save.disabled = false;
}

/** Panel state: which view this one panel shows. Gone once the panel is closed. */
async function setUpView(tavora: TavoraSDK) {
  const show = (view: View) => {
    el("view").textContent = view;
  };
  show((await tavora.panel.getState<{ view: View }>())?.view ?? "list");
  for (const view of ["list", "grid"] as const) {
    const button = el<HTMLButtonElement>(`view-${view}`);
    button.addEventListener("click", async () => {
      show(view);
      await tavora.panel.setState({ view });
    });
    button.disabled = false;
  }
}

/** Maximize: this panel fills the workspace, by its own button or the panel's menu. Only this example has it. */
async function setUpMaximize(tavora: TavoraSDK) {
  let maximized = await tavora.panel.isMaximized();
  const button = el<HTMLButtonElement>("toggle-maximized");
  const show = (value: boolean) => {
    maximized = value;
    el("maximized").textContent = value ? "yes" : "no";
    button.textContent = value ? "Restore" : "Maximize";
  };
  show(maximized);
  tavora.panel.onMaximizedChange(show);
  button.addEventListener("click", () => {
    tavora.panel.setMaximized(!maximized).catch((error: unknown) => {
      el("maximized").textContent = error instanceof TavoraError ? error.code : String(error);
    });
  });
  button.disabled = false;
}

function setUpLifecycle(tavora: TavoraSDK) {
  el("lifecycle").textContent = "active";
  tavora.lifecycle.onSuspend(() => {
    el("lifecycle").textContent = "suspended";
  });
  tavora.lifecycle.onResume(() => {
    el("lifecycle").textContent = "active";
  });
}

try {
  const tavora = await connect();
  const [workspace, viewport, theme] = await Promise.all([
    tavora.workspace.getCurrent(),
    tavora.workspace.getViewport(),
    tavora.ui.getTheme(),
  ]);
  el("workspace").textContent = workspace.displayName;
  el("workspace").dataset.workspaceId = workspace.id;
  el("viewport").textContent = `${viewport.width} × ${viewport.height}`;
  applyTheme(theme);
  tavora.workspace.onResize(({ width, height }) => {
    el("viewport").textContent = `${width} × ${height}`;
  });
  tavora.ui.onThemeChange(applyTheme);
  setUpLifecycle(tavora);
  await Promise.all([setUpCounter(tavora), setUpNote(tavora), setUpView(tavora), setUpMaximize(tavora)]);
  el("status").textContent = "Connected";
} catch (error) {
  el("status").textContent = `Could not connect: ${error instanceof Error ? error.message : String(error)}`;
}
