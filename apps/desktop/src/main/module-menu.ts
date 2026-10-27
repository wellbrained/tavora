import { LIMITS, type MenuEntry, type MenuRequest } from "@tavora/sdk/protocol";
import { HostError } from "./errors";

// A menu a module asks Tavora to draw (ui.showMenu). Everything is checked here and rebuilt from
// known fields only: text stays text, colours are plain CSS colour values, and the host UI only
// ever sees this checked copy.

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
/** A CSS colour without anything that could load or run: hex, a colour function of numbers, or transparent. */
const COLOR = /^(?:#[0-9a-f]{3,8}|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\([0-9.%\s,/+-]{1,60}\)|transparent)$/i;
/** Largest offset or size accepted for `at`, in CSS pixels. */
const MAX_COORDINATE = 100_000;

export interface CheckedMenu {
  request: MenuRequest;
  /** Ids the user can pick: items that are not disabled, in submenus that are not disabled. */
  choices: ReadonlySet<string>;
}

function invalid(message: string): never {
  throw new HostError("INVALID_PARAMS", message);
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function only(value: Record<string, unknown>, allowed: string[], name: string): void {
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length > 0) invalid(`${name} has unknown fields: ${extra.join(", ")}`);
}

function text(value: unknown, max: number, name: string): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) invalid(`${name} must be text of 1 to ${max} characters`);
  return value;
}

function flag(value: unknown, name: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") invalid(`${name} must be true or false`);
  return value;
}

function color(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !COLOR.test(value)) invalid(`${name} must be a CSS colour such as #e5675a or oklch(0.7 0.17 150)`);
  return value;
}

function coordinate(value: unknown, name: string, optional: boolean): number | undefined {
  if (value === undefined && optional) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > MAX_COORDINATE) invalid(`${name} must be a number of CSS pixels`);
  return value;
}

/** Keeps a field off the result when it was left out, so the copy holds only what the module sent. */
function defined<R>(value: Record<string, unknown>): R {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as R;
}

export function checkMenu(params: unknown): CheckedMenu {
  const raw = record(params, "params");
  only(raw, ["items", "at", "side", "align"], "params");
  const ids = new Set<string>();
  const choices = new Set<string>();
  let count = 0;

  const entries = (value: unknown, name: string, nested: boolean, enabled: boolean): MenuEntry[] => {
    if (!Array.isArray(value) || value.length === 0) invalid(`${name} must be a list of at least one entry`);
    return value.map((item, index): MenuEntry => {
      if (++count > LIMITS.maxMenuEntries) invalid(`a menu has at most ${LIMITS.maxMenuEntries} entries`);
      const where = `${name}[${index}]`;
      const entry = record(item, where);
      switch (entry.type) {
        case "separator":
          only(entry, ["type"], where);
          return { type: "separator" };
        case "heading":
          only(entry, ["type", "label"], where);
          return { type: "heading", label: text(entry.label, LIMITS.maxMenuLabel, `${where}.label`) };
        case "item": {
          only(entry, ["type", "id", "label", "hint", "color", "checked", "radio", "disabled", "danger"], where);
          if (typeof entry.id !== "string" || !ID.test(entry.id)) invalid(`${where}.id must be 1 to 64 letters, digits, ".", "_", ":" or "-"`);
          if (ids.has(entry.id)) invalid(`${where}.id "${entry.id}" is used twice`);
          ids.add(entry.id);
          const disabled = flag(entry.disabled, `${where}.disabled`);
          if (enabled && !disabled) choices.add(entry.id);
          return defined<MenuEntry>({
            type: "item",
            id: entry.id,
            label: text(entry.label, LIMITS.maxMenuLabel, `${where}.label`),
            hint: entry.hint === undefined ? undefined : text(entry.hint, LIMITS.maxMenuHint, `${where}.hint`),
            color: color(entry.color, `${where}.color`),
            checked: flag(entry.checked, `${where}.checked`),
            radio: flag(entry.radio, `${where}.radio`),
            disabled,
            danger: flag(entry.danger, `${where}.danger`),
          });
        }
        case "submenu": {
          if (nested) invalid(`${where}: a submenu holds no further submenus`);
          only(entry, ["type", "label", "color", "disabled", "items"], where);
          const disabled = flag(entry.disabled, `${where}.disabled`);
          return defined<MenuEntry>({
            type: "submenu",
            label: text(entry.label, LIMITS.maxMenuLabel, `${where}.label`),
            color: color(entry.color, `${where}.color`),
            disabled,
            items: entries(entry.items, `${where}.items`, true, enabled && !disabled),
          });
        }
        default:
          invalid(`${where}.type must be "item", "separator", "heading" or "submenu"`);
      }
    });
  };

  const items = entries(raw.items, "params.items", false, true);
  const at = record(raw.at, "params.at");
  only(at, ["x", "y", "width", "height"], "params.at");
  const width = coordinate(at.width, "params.at.width", true);
  const height = coordinate(at.height, "params.at.height", true);
  if ((width !== undefined && width < 0) || (height !== undefined && height < 0)) invalid("params.at.width and height must not be negative");
  const side = raw.side;
  if (side !== undefined && side !== "bottom" && side !== "top" && side !== "right" && side !== "left") invalid('params.side must be "bottom", "top", "right" or "left"');
  const align = raw.align;
  if (align !== undefined && align !== "start" && align !== "center" && align !== "end") invalid('params.align must be "start", "center" or "end"');
  const request = defined<MenuRequest>({
    items,
    at: defined<MenuRequest["at"]>({ x: coordinate(at.x, "params.at.x", false)!, y: coordinate(at.y, "params.at.y", false)!, width, height }),
    side: side as MenuRequest["side"],
    align: align as MenuRequest["align"],
  });
  return { request, choices };
}
