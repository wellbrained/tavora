/**
 * The end of a `switch` over a union that handles every case: TypeScript refuses the call once a new case is added and
 * not handled. Reached at run time only when a value came from somewhere the types don't cover; it throws then.
 */
export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(value)}`);
}
