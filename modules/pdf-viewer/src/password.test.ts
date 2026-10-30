import { describe, expect, it, vi } from "vitest";
import { passwordAnswerer } from "./password";

const WRONG = 2;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("passwordAnswerer", () => {
  it("asks for the password and hands it over", async () => {
    const ask = vi.fn(async () => "secret");
    const update = vi.fn();
    const cancel = vi.fn();
    passwordAnswerer(ask, (reason) => reason === WRONG, cancel)(update, 1);
    await flush();
    expect(ask).toHaveBeenCalledWith(false);
    expect(update).toHaveBeenCalledWith("secret");
    expect(cancel).not.toHaveBeenCalled();
  });

  it("says when the last password was wrong, so the reader can try again", async () => {
    const ask = vi.fn(async () => "again");
    const update = vi.fn();
    passwordAnswerer(ask, (reason) => reason === WRONG, vi.fn())(update, WRONG);
    await flush();
    expect(ask).toHaveBeenCalledWith(true);
    expect(update).toHaveBeenCalledWith("again");
  });

  it("cancels when the reader gives up", async () => {
    const update = vi.fn();
    const cancel = vi.fn();
    passwordAnswerer(async () => null, () => false, cancel)(update, 1);
    await flush();
    expect(update).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });
});
