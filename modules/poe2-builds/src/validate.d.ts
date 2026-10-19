import type { Build } from './model';
/** Validates a portable Tavora v1 document, rejecting malformed files before storage. */
export function validate(document: unknown): Build;
