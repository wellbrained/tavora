/** The bits of an IPC event the sender check reads. */
export interface SenderEvent {
  sender: { id: number };
  senderFrame?: { parent: unknown } | null;
}

/**
 * True only for the host window's own page: its web contents, and its main frame (not a sub-frame).
 * The host:* actions (publish, keys, catalog, ...) are for that page alone; a module's panel never passes.
 */
export function isHostSender(event: SenderEvent, hostContentsId: number): boolean {
  return event.sender.id === hostContentsId && event.senderFrame?.parent === null;
}

/** Pulls the packaged-build gate out of the publish flow so it can be tested alone. */
export function officialPublishAllowed(packaged: boolean, pinsOn: boolean): boolean {
  return !packaged && pinsOn;
}
