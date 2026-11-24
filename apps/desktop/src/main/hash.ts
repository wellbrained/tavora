import { createHash } from "node:crypto";

/** The SHA-256 of some text or bytes, as lower-case hex. */
export const sha256Hex = (data: string | NodeJS.ArrayBufferView): string => createHash("sha256").update(data).digest("hex");
