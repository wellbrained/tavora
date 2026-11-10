// Which events in a module's page count as the user's press (see module.ts).
// Only real ones: a script cannot make an event trusted. A held key is one press, not one per auto-repeat,
// and a modifier alone (the Ctrl of Ctrl+C) is no press at all.
const MODIFIERS = new Set(["Alt", "AltGraph", "CapsLock", "Control", "Fn", "FnLock", "Hyper", "Meta", "NumLock", "OS", "ScrollLock", "Shift", "Super", "Symbol", "SymbolLock"]);

export function countsAsPress(event: Event): boolean {
  if (!event.isTrusted) return false;
  if (event.type !== "keydown") return true;
  const key = event as KeyboardEvent;
  return !key.repeat && !MODIFIERS.has(key.key);
}
