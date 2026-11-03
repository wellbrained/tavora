/**
 * The end of an exhaustive `switch` over a union: the compiler fails here when a case is left out, and at run time a
 * value no case knows (an old or a newer shape) throws instead of slipping through.
 */
export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(value)}`);
}
