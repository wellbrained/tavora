/** One look in `StyleTiles`. */
export interface StyleTileOption<V extends string = string> {
  value: V
  /** The name under the picture, and what screen readers call the tile. */
  label: string
  /** What the picture shows that the name doesn't (a state: "Locked", "3 of 5 made"). Only screen readers hear it, after the name. */
  description?: string
  testid?: string
}
