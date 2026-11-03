/**
 * The texts of an item card's footer: the module's name, and on the right what the user can do with the card. A pinned
 * card says how to close it; a hover card says it can be pinned, unless the module said it can't (`pinnable: false`),
 * and then only the name stays.
 */
export function footerTexts(source: string, state: { pinned: boolean; pinnable: boolean }, de: boolean): string[] {
    if (state.pinned)
        return [source, de ? "Angeheftet · Esc zum Schließen" : "Pinned · Escape to close"];
    if (!state.pinnable)
        return [source];
    return [source, de ? "Klicken zum Anheften" : "Click to pin item details"];
}
