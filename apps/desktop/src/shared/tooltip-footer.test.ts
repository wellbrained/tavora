import { describe, expect, it } from "vitest";
import { footerTexts } from "./tooltip-footer";
describe("footerTexts", () => {
    it("says a hover card can be pinned, as before", () => {
        expect(footerTexts("PoE2 Builds", { pinned: false, pinnable: true }, false)).toEqual(["PoE2 Builds", "Click to pin item details"]);
        expect(footerTexts("PoE2 Builds", { pinned: false, pinnable: true }, true)).toEqual(["PoE2 Builds", "Klicken zum Anheften"]);
    });
    it("keeps only the source name when the card can't be pinned", () => {
        expect(footerTexts("Satisfactory", { pinned: false, pinnable: false }, false)).toEqual(["Satisfactory"]);
        expect(footerTexts("Satisfactory", { pinned: false, pinnable: false }, true)).toEqual(["Satisfactory"]);
    });
    it("says how to close a pinned card", () => {
        expect(footerTexts("PoE2 Builds", { pinned: true, pinnable: true }, false)).toEqual(["PoE2 Builds", "Pinned · Escape to close"]);
        expect(footerTexts("PoE2 Builds", { pinned: true, pinnable: true }, true)[1]).toBe("Angeheftet · Esc zum Schließen");
    });
});
