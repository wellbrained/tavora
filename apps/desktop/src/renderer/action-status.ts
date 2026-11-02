import { computed, onScopeDispose, shallowRef } from "vue";
import type { ProgressButtonStatus } from "@tavora/official-ui/components/ui/progress-button";

/** How long a button keeps saying it worked ("✓ Installed") before it goes back to being a button. */
export const DONE_FOR_MS = 1600;

/**
 * Which buttons are working or just worked, by id, for ProgressButton. `run` takes the id's work and answers whether it
 * worked: a failure puts the button back at once (the caller shows the error), a success keeps "done" for a moment.
 */
export function useActionStatus() {
  const states = shallowRef<Readonly<Record<string, Exclude<ProgressButtonStatus, "idle">>>>({});
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const set = (id: string, status: Exclude<ProgressButtonStatus, "idle"> | null) => {
    const { [id]: _gone, ...rest } = states.value;
    states.value = status === null ? rest : { ...rest, [id]: status };
  };

  async function run(id: string, work: () => Promise<boolean>): Promise<boolean> {
    set(id, "busy");
    let ok = false;
    try {
      ok = await work();
    } finally {
      if (ok) {
        set(id, "done");
        const timer = setTimeout(() => {
          timers.delete(timer);
          set(id, null);
        }, DONE_FOR_MS);
        timers.add(timer);
      } else set(id, null);
    }
    return ok;
  }

  onScopeDispose(() => timers.forEach(clearTimeout));

  return {
    statusOf: (id: string): ProgressButtonStatus => states.value[id] ?? "idle",
    run,
    /** Something is working (not only done), so other buttons that start the same kind of work wait. */
    working: computed(() => Object.values(states.value).includes("busy")),
    /** Something is working or has just worked. */
    active: computed(() => Object.keys(states.value).length > 0),
  };
}
