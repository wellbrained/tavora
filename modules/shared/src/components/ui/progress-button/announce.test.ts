import { describe, expect, it } from "vitest"
import { announcement } from "./announce"

const labels = { busy: "Installing…", done: "Installed", failed: "Couldn't install" }

describe("announcement", () => {
  it("says the busy label when the work starts and the done label when it worked", () => {
    expect(announcement("idle", "busy", labels)).toBe("Installing…")
    expect(announcement("busy", "done", labels)).toBe("Installed")
  })
  it("says the failed label when busy ends without working", () => {
    expect(announcement("busy", "idle", labels)).toBe("Couldn't install")
    expect(announcement("busy", "idle", { busy: "a", done: "b" })).toBe("")
  })
  it("says nothing when done goes back to idle, or nothing changed", () => {
    expect(announcement("done", "idle", labels)).toBe("")
    expect(announcement("busy", "busy", labels)).toBe("")
  })
})
