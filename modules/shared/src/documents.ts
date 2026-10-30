// Small helpers left from before the document store.
// `serial` is deprecated: `openDocument` from `@tavora/sdk/store` (or `useDocument`) saves one after another by itself.
// It stays only for modules that still call it.

/**
 * @deprecated The document store saves one after another by itself.
 *
 * Runs async jobs one after another, so saves from one panel never overlap.
 */
export function serial(): <R>(job: () => Promise<R>) => Promise<R> {
  let tail: Promise<unknown> = Promise.resolve();
  return (job) => {
    const run = tail.then(job, job);
    tail = run.catch(() => undefined);
    return run;
  };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
