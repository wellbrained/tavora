import { open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// writeFileAtomic flushes every file to the disk (FileHandle.sync) so a power cut can't leave it half written. A test
// can't see that: a power cut doesn't happen inside one. On macOS it is also a full flush that takes tens of
// milliseconds and far more when many test files write at once, which is what made the slow tests time out. So tests
// skip the flush; the write and the rename around it stay real.
const probe = path.join(tmpdir(), `tavora-fsync-probe-${process.pid}`);
const handle = await open(probe, "w");
const prototype = Object.getPrototypeOf(handle) as { sync: () => Promise<void> };
await handle.close();
await rm(probe, { force: true });
prototype.sync = async () => undefined;
