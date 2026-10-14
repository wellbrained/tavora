import type { Capability, ErrorCode, ErrorPayload } from "@tavora/sdk/protocol";

/** An error the host reports to the module as-is. Anything else becomes INTERNAL. */
export class HostError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly extra: { capability?: Capability; revision?: number; supported?: number[] } = {},
  ) {
    super(message);
    this.name = "HostError";
  }

  toPayload(): ErrorPayload {
    return { code: this.code, message: this.message, ...this.extra };
  }
}
