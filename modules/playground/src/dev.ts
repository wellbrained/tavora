// The developer tools' "Show disabled" switch, handed to every example. An example reads it with `useOff()` and
// passes it to its controls' `disabled`; "Show code" leaves this wiring out (see `exampleCode` in pages.ts).
import { inject, provide, ref, type Ref } from "vue";

const OFF = Symbol("playground-off");

export function provideOff(off: Ref<boolean>) {
  provide(OFF, off);
}

export function useOff(): Ref<boolean> {
  return inject(OFF, ref(false));
}
