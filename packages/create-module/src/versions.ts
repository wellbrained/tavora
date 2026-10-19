// What a new module starts with: the SDK and pack versions released together with this starter,
// and the oldest Tavora that has everything that SDK offers (its MIN_TAVORA). A test keeps these
// equal to the packages in Tavora's repository, so a release never ships an old starter.
export const VERSIONS = {
  sdk: "0.2.7",
  pack: "0.1.3",
  minTavora: "0.18.2",
} as const;
