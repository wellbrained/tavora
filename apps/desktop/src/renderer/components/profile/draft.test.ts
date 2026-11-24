// The name and initials typed in the profile dialog follow the real profile when it changes underneath (the account's
// profile was taken, a sync), unless the user has typed something of their own there.
import { describe, expect, it } from "vitest";
import { followProfile } from "./draft";

describe("followProfile", () => {
  it("takes the new profile when nothing was typed", () => {
    expect(followProfile({ name: "Old", initials: "O" }, { name: "Old", initials: "O" }, { name: "Account", initials: "AC" })).toEqual({ name: "Account", initials: "AC" });
  });
  it("keeps what was typed", () => {
    expect(followProfile({ name: "Typed", initials: "O" }, { name: "Old", initials: "O" }, { name: "Account", initials: "AC" })).toEqual({ name: "Typed", initials: "AC" });
  });
  it("leaves the draft alone when the profile is the same", () => {
    const draft = { name: "Typed", initials: "T" };
    expect(followProfile(draft, { name: "Old", initials: "O" }, { name: "Old", initials: "O" })).toBe(draft);
  });
});
