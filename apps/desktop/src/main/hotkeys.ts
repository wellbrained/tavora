// Hotkeys for module actions (the manifest's `actions`, hotkeys.set). The player picks each key in Tavora's own
// dialog, for one game; the module only hears which action fired for which target. Keys are registered with the
// system only for the game shown now, and only for modules with a panel in its workspace, so a key does nothing
// (and is not taken from other programs) anywhere else. Kept in hotkeys.json in the data folder.
import path from "node:path";
import { LIMITS } from "@tavora/sdk/protocol";
import { isHotkey } from "../shared/hotkey-keys";
import { SerialQueue, writeFileAtomic } from "./fsutil";
import { readJsonOrSetAside } from "./json";

export const HOTKEYS_FILE = "hotkeys.json";

export interface HotkeyRecord {
  owner: string;
  moduleId: string;
  gameId: string;
  /** One of the module's manifest `actions` ids. */
  action: string;
  /** The module's own id for what the action works on. */
  target: string;
  /** What the module called the target when the key was set, for Settings. */
  label: string;
  /** The key, as an Electron accelerator (shared/hotkey-keys.ts). */
  accelerator: string;
}

type HotkeyFile = { version: 1; hotkeys: HotkeyRecord[] };

const FIELDS = ["owner", "moduleId", "gameId", "action", "target", "label"] as const;

/** Whether two records are for the same action on the same target of one module in one game. */
export function sameBinding(a: Omit<HotkeyRecord, "label" | "accelerator">, b: Omit<HotkeyRecord, "label" | "accelerator">): boolean {
  return a.owner === b.owner && a.moduleId === b.moduleId && a.gameId === b.gameId && a.action === b.action && a.target === b.target;
}

export class HotkeyStore {
  private readonly queue = new SerialQueue();

  private constructor(
    private readonly file: string,
    private records: HotkeyRecord[],
  ) {}

  static async load(userData: string): Promise<HotkeyStore> {
    const file = path.join(userData, HOTKEYS_FILE);
    const raw = await readJsonOrSetAside<Partial<HotkeyFile>>(file);
    const records: HotkeyRecord[] = [];
    for (const entry of Array.isArray(raw?.hotkeys) ? raw.hotkeys : []) {
      if (typeof entry !== "object" || entry === null) continue;
      const record = entry as Partial<HotkeyRecord>;
      if (!FIELDS.every((field) => typeof record[field] === "string" && record[field]!.length <= 200) || !isHotkey(record.accelerator)) continue;
      records.push({ ...(record as HotkeyRecord) });
    }
    return new HotkeyStore(file, records);
  }

  all(): readonly HotkeyRecord[] {
    return this.records;
  }

  /** A module's hotkeys in one game. */
  of(owner: string, moduleId: string, gameId: string): HotkeyRecord[] {
    return this.records.filter((record) => record.owner === owner && record.moduleId === moduleId && record.gameId === gameId);
  }

  find(binding: Omit<HotkeyRecord, "label" | "accelerator">): HotkeyRecord | undefined {
    return this.records.find((record) => sameBinding(record, binding));
  }

  /** The other hotkey of a game that uses this key, if any. */
  conflict(binding: Omit<HotkeyRecord, "label" | "accelerator">, accelerator: string): HotkeyRecord | undefined {
    return this.records.find((record) => record.gameId === binding.gameId && record.accelerator === accelerator && !sameBinding(record, binding));
  }

  /** Sets (or changes) the key of a binding; false when the module already has the most hotkeys in this game. */
  set(record: HotkeyRecord): boolean {
    const index = this.records.findIndex((item) => sameBinding(item, record));
    if (index >= 0) this.records[index] = { ...record };
    else if (this.of(record.owner, record.moduleId, record.gameId).length >= LIMITS.maxHotkeys) return false;
    else this.records.push({ ...record });
    void this.save();
    return true;
  }

  /** Removes the hotkeys matching `test`; whether any went. */
  remove(test: (record: HotkeyRecord) => boolean): boolean {
    const kept = this.records.filter((record) => !test(record));
    if (kept.length === this.records.length) return false;
    this.records = kept;
    void this.save();
    return true;
  }

  private save(): Promise<void> {
    const text = `${JSON.stringify({ version: 1, hotkeys: this.records } satisfies HotkeyFile, null, 2)}\n`;
    return this.queue.run(() => writeFileAtomic(this.file, text)).catch((error: unknown) => console.error("[tavora] saving hotkeys failed", error));
  }
}

/** The part of Electron's globalShortcut the registrar uses. */
export interface ShortcutRegistry {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

/**
 * Keeps the system's registered keys in step with the hotkeys that should work now. Applying the same set again
 * changes nothing, so it can run on every state change.
 */
export class HotkeyRegistrar {
  private active = new Map<string, HotkeyRecord>();
  private paused = false;
  /** Keys another program holds right now, so Settings can say so. */
  readonly taken = new Set<string>();
  private wanted: HotkeyRecord[] = [];

  constructor(
    private readonly shortcuts: ShortcutRegistry,
    private readonly pressed: (record: HotkeyRecord) => void,
  ) {}

  /** Registers exactly these hotkeys (unless paused); returns whether anything changed. */
  apply(records: readonly HotkeyRecord[]): boolean {
    this.wanted = [...records];
    if (this.paused) return false;
    const next = new Map(records.map((record) => [record.accelerator, record]));
    let changed = false;
    for (const [accelerator, record] of this.active) {
      const want = next.get(accelerator);
      if (want && sameBinding(want, record)) continue;
      this.shortcuts.unregister(accelerator);
      this.active.delete(accelerator);
      changed = true;
    }
    for (const [accelerator, record] of next) {
      if (this.active.has(accelerator)) continue;
      changed = true;
      if (this.shortcuts.register(accelerator, () => this.pressed(record))) {
        this.active.set(accelerator, record);
        this.taken.delete(accelerator);
      } else {
        this.taken.add(accelerator);
      }
    }
    for (const accelerator of [...this.taken]) if (!next.has(accelerator)) this.taken.delete(accelerator);
    return changed;
  }

  /** Lets every key go, so Tavora's hotkey dialog can catch any of them; resume puts them back. */
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    for (const accelerator of this.active.keys()) this.shortcuts.unregister(accelerator);
    this.active.clear();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.apply(this.wanted);
  }

  /** Whether another program holds a key: tries to register it for a moment. Only while paused, so Tavora's own keys are free. */
  isTaken(accelerator: string): boolean {
    if (!this.shortcuts.register(accelerator, () => {})) return true;
    this.shortcuts.unregister(accelerator);
    return false;
  }

  /** Lets every key go for good (quitting). */
  clear(): void {
    for (const accelerator of this.active.keys()) this.shortcuts.unregister(accelerator);
    this.active.clear();
    this.wanted = [];
  }
}
