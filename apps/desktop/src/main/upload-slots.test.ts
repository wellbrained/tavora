import { describe, expect, it } from "vitest";
import { takeUploadSlot, UPLOADS_AT_ONCE, UPLOADS_WAITING, type UploadSlots } from "./upload-slots";

describe("takeUploadSlot (audit L8)", () => {
  it("lets a session write UPLOADS_AT_ONCE files at once, queues the next ones in order and refuses past UPLOADS_WAITING", async () => {
    const slots: UploadSlots = { writing: 0, queued: [] };
    const running = await Promise.all(Array.from({ length: UPLOADS_AT_ONCE }, () => takeUploadSlot(slots)!));
    expect(slots.writing).toBe(UPLOADS_AT_ONCE);
    const order: number[] = [];
    const waiting = Array.from({ length: UPLOADS_WAITING }, (_, index) => takeUploadSlot(slots)!.then((free) => (order.push(index), free)));
    expect(takeUploadSlot(slots)).toBeNull();
    // Freeing one hands its slot to the oldest waiting upload; freeing twice frees once.
    running[0]!();
    running[0]!();
    const first = await waiting[0]!;
    expect(order).toEqual([0]);
    expect(slots.writing).toBe(UPLOADS_AT_ONCE);
    for (const free of running.slice(1)) free();
    first();
    for (const next of waiting.slice(1)) (await next)();
    expect(order).toEqual(Array.from({ length: UPLOADS_WAITING }, (_, index) => index));
    expect(slots).toEqual({ writing: 0, queued: [] });
  });
});
