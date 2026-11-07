// Where `mountPanel` (@tavora/sdk/testing) leaves the SDK for the panel it is starting, so the module's own `connect()`
// (or `bootstrapModule()`, or the kit's `connectModule()`) gets a memory host instead of a handshake with Tavora. Only test
// code fills it; in Tavora it stays empty and `connect()` works as always. Not part of the public API.
//
// It lives on globalThis under a registered symbol, so it works when a test page ends up with two copies of the SDK (its
// sources and its build, say). A page could fill it itself, but that only fakes its own SDK: it reaches nothing new.
import type { TavoraSDK } from "./index.js";

export interface TestSdkSlot {
  sdk: TavoraSDK;
  /** Called once, when a `connect()` took the SDK. */
  taken(): void;
}

interface Holder {
  /** The panel that is starting now. */
  next?: TestSdkSlot | undefined;
  /**
   * SDKs handed out to panels that are still open, newest last. A later `connect()` gets the newest, as in Tavora every
   * `connect()` of a page returns the same connection.
   */
  open: TavoraSDK[];
}

const KEY = Symbol.for("@tavora/sdk/testing:panels");

function holder(create: boolean): Holder | undefined {
  const scope = globalThis as { [KEY]?: Holder };
  if (!scope[KEY] && create) scope[KEY] = { open: [] };
  return scope[KEY];
}

export function putTestSdk(slot: TestSdkSlot | undefined): void {
  holder(true)!.next = slot;
}

/** Called when a test panel closes: its SDK is no longer handed out. */
export function dropTestSdk(sdk: TavoraSDK): void {
  const state = holder(false);
  if (state) state.open = state.open.filter((one) => one !== sdk);
}

export function takeTestSdk(): TavoraSDK | undefined {
  const state = holder(false);
  if (!state) return undefined;
  const slot = state.next;
  if (!slot) return state.open.at(-1);
  state.next = undefined;
  state.open.push(slot.sdk);
  slot.taken();
  return slot.sdk;
}
