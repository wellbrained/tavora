// The panel's menu (the ⋯ button), drawn by Tavora with ui.showMenu. Item ids say what a pick does.
import type { MenuEntry, SystemConnectionSettings, SystemInfo } from "@tavora/sdk";
import { BLOCKS, INTERVALS, SECTIONS, pickGpu, type AppSettings, type BlockId, type PanelSettings, type SectionId } from "./settings";

export type Pick =
  | { kind: "section"; id: SectionId }
  | { kind: "block"; id: BlockId }
  | { kind: "interval"; ms: (typeof INTERVALS)[number] }
  | { kind: "gpu"; id: string }
  | { kind: "drives" }
  | { kind: "traffic" }
  | { kind: "connection" };

/** Writes a text of the panel in the language shown (the panel passes its `t`). */
export type Say = (key: any, params?: Record<string, string | number>) => string;

/**
 * The ⋯ menu. `connection` is what Tavora's watcher is set to, or null while that is unknown (an older Tavora has no
 * watcher, so its choices stay out).
 */
export function buildMenu(t: Say, info: SystemInfo | null, app: AppSettings, panel: PanelSettings, connection: SystemConnectionSettings | null = null): MenuEntry[] {
  const shown = BLOCKS.filter((id) => panel.blocks[id]);
  const sections = SECTIONS.filter((id) => panel.sections[id]);
  const items: MenuEntry[] = [
    { type: "heading", label: t("menu.sections") },
    ...SECTIONS.map((id): MenuEntry => ({
      type: "item",
      id: `section:${id}`,
      label: t(`section.${id}`),
      checked: panel.sections[id],
      // The last section shown stays.
      disabled: sections.length === 1 && panel.sections[id],
    })),
  ];
  if (panel.sections.system) {
    items.push(
      { type: "separator" },
      { type: "heading", label: t("menu.show") },
      ...BLOCKS.map((id): MenuEntry => ({
        type: "item",
        id: `block:${id}`,
        label: t(`${id}.title`),
        checked: panel.blocks[id],
        // The last block shown stays.
        disabled: shown.length === 1 && panel.blocks[id],
      })),
    );
  }
  items.push(
    { type: "separator" },
    { type: "heading", label: t("menu.interval") },
    ...INTERVALS.map((ms): MenuEntry => ({ type: "item", id: `interval:${ms}`, label: t("menu.seconds", { seconds: ms / 1000 }), checked: app.intervalMs === ms, radio: true })),
  );
  if (panel.sections.system && info && info.gpus.length > 1) {
    const current = pickGpu(info, panel.gpu);
    items.push(
      { type: "separator" },
      { type: "heading", label: t("menu.gpu") },
      ...info.gpus.map((gpu): MenuEntry => ({ type: "item", id: `gpu:${gpu.id}`, label: gpu.name, checked: gpu.id === current, radio: true })),
    );
  }
  if (panel.sections.system) items.push({ type: "separator" }, { type: "item", id: "drives", label: t("menu.drives") });
  if (connection) {
    // One dialog for both choices, so one click saves them (Tavora wants a click for what changes the whole PC).
    items.push(
      { type: "separator" },
      { type: "item", id: "connection", label: t("menu.connection"), hint: connection.enabled ? (connection.target.length <= 30 ? connection.target : `${connection.target.slice(0, 29)}…`) : t("menu.connectionOff") },
    );
  }
  // The traffic goes with the connection: a tick, under Connection… when that is there.
  if (panel.sections.connection) items.push(...(connection ? [] : [{ type: "separator" } as const]), { type: "item", id: "traffic", label: t("menu.traffic"), checked: panel.traffic });
  return items;
}

/** What a picked menu item asks for, or null for an id this menu doesn't have. */
export function parsePick(id: string): Pick | null {
  if (id === "drives") return { kind: "drives" };
  if (id === "connection") return { kind: "connection" };
  if (id === "traffic") return { kind: "traffic" };
  const [kind, rest = ""] = [id.slice(0, id.indexOf(":")), id.slice(id.indexOf(":") + 1)];
  if (kind === "section" && (SECTIONS as readonly string[]).includes(rest)) return { kind: "section", id: rest as SectionId };
  if (kind === "block" && (BLOCKS as readonly string[]).includes(rest)) return { kind: "block", id: rest as BlockId };
  if (kind === "interval") {
    const ms = INTERVALS.find((value) => String(value) === rest);
    return ms ? { kind: "interval", ms } : null;
  }
  if (kind === "gpu" && rest) return { kind: "gpu", id: rest };
  return null;
}
