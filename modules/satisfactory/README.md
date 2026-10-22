# Satisfactory Planner

A Tavora module for Satisfactory: plan production lines and look up items, recipes and buildings while you play.

## Panels

**Planner.** Say what you want to make and how much per minute, and what you already bring from elsewhere. The Planner shows one row per recipe with its building, how many machines it takes (exactly and rounded up), their clock speed and power, and lets you pick another recipe for any item. Below that: the raw resources, what you have to bring in, which of your supplies are used, byproducts, what is left over, total power and build cost. Every change is worked out at once and saved.

- See the production as a **Chain** (each target down to its raw resources), a **Graph** (a box per recipe, arrows with the rates between them; drag to move, Ctrl + scroll to zoom) or a **List**.
- Keep as many named plans as you like, and export or import them as files.
- A world holds the alternate recipes you've unlocked in one playthrough. **Alternates…** lets you tick them, or show all of them to theory-craft. "My world" is there from the start.
- Each Planner panel remembers its plan. Plans and worlds are shared by all panels of the game.

**Codex.** Search items, recipes and buildings in English or German. An item shows its form, stack size, sink points and energy, the recipes that make it (with how they unlock: milestone, MAM, hard drive or AWESOME Shop) and the recipes that use it. A building shows its power, build cost and the recipes it runs. Every entry links to the ones around it. **Plan this** opens a Planner with a new plan for the item, and **Wiki** opens its page on the community wiki.

Names follow the language Tavora is set to (English or German).

## Offline

The module needs no network: the game data and icons ship with it. Only the Wiki button opens a web page, in Tavora's Browser.

## Data

The game data comes from the game's own `CommunityResources/Docs` files, pinned to one game build, and is extracted into the module when it is built.

## Development

```sh
pnpm --filter @tavora/satisfactory build
pnpm --filter @tavora/satisfactory typecheck
pnpm vitest run modules/satisfactory
```

To try changes in Tavora as you make them, add this folder as a development folder and keep a build running; Tavora reloads the panels after each build:

```sh
pnpm --filter @tavora/satisfactory exec vite build --watch
```

A link (junction) inside a development folder isn't picked up; add the linked folder itself.

---

Not affiliated with Coffee Stain Studios. Satisfactory and its icons are © Coffee Stain Studios and belong to them. If Coffee Stain asks us to, we take the icons out right away.
