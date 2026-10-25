// The panel's menu (the ⋯ button), drawn by Tavora with ui.showMenu. Item ids say what a pick does.
import type { MenuEntry, SystemInfo } from "@tavora/sdk";
import { BLOCKS, INTERVALS, pickGpu, type AppSettings, type BlockId, type PanelSettings } from "./settings";

export type Pick = { kind: "block"; id: BlockId } | { kind: "interval"; ms: (typeof INTERVALS)[number] } | { kind: "gpu"; id: string } | { kind: "drives" };

/** Writes a text of the panel in the language shown (the panel passes its `t`). */
export type Say = (key: any, params?: Record<string, string | number>) => string;

export function buildMenu(t: Say, info: SystemInfo | null, app: AppSettings, panel: PanelSettings): MenuEntry[] {
  const shown = BLOCKS.filter((id) => panel.blocks[id]);
  const items: MenuEntry[] = [
    { type: "heading", label: t("menu.show") },
    ...BLOCKS.map((id): MenuEntry => ({
      type: "item",
      id: `block:${id}`,
      label: t(`${id}.title`),
      checked: panel.blocks[id],
      // The last block shown stays.
      disabled: shown.length === 1 && panel.blocks[id],
    })),
    { type: "separator" },
    { type: "heading", label: t("menu.interval") },
    ...INTERVALS.map((ms): MenuEntry => ({ type: "item", id: `interval:${ms}`, label: t("menu.seconds", { seconds: ms / 1000 }), checked: app.intervalMs === ms, radio: true })),
  ];
  if (info && info.gpus.length > 1) {
    const current = pickGpu(info, panel.gpu);
    items.push(
      { type: "separator" },
      { type: "heading", label: t("menu.gpu") },
      ...info.gpus.map((gpu): MenuEntry => ({ type: "item", id: `gpu:${gpu.id}`, label: gpu.name, checked: gpu.id === current, radio: true })),
    );
  }
  items.push({ type: "separator" }, { type: "item", id: "drives", label: t("menu.drives") });
  return items;
}

/** What a picked menu item asks for, or null for an id this menu doesn't have. */
export function parsePick(id: string): Pick | null {
  if (id === "drives") return { kind: "drives" };
  const [kind, rest = ""] = [id.slice(0, id.indexOf(":")), id.slice(id.indexOf(":") + 1)];
  if (kind === "block" && (BLOCKS as readonly string[]).includes(rest)) return { kind: "block", id: rest as BlockId };
  if (kind === "interval") {
    const ms = INTERVALS.find((value) => String(value) === rest);
    return ms ? { kind: "interval", ms } : null;
  }
  if (kind === "gpu" && rest) return { kind: "gpu", id: rest };
  return null;
}
