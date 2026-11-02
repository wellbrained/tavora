import { readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, it } from "vitest"

// The done title is struck with the kit's drawing line (modules/shared/src/motion.css, .tavora-strike): the class is
// always there and data-struck switches the line on, so ticking draws it and unticking takes it back.
it("marks a done title with the kit's strike line, not a text-decoration", () => {
  const source = readFileSync(join(import.meta.dirname, "TaskRow.vue"), "utf8")
  const title = source.split("\n").find((line) => line.includes('data-testid="task-title"'))
  expect(title).toBeDefined()
  expect(title).toContain("tavora-strike")
  expect(title).toContain(':data-struck="task.done || undefined"')
  expect(title).not.toContain("line-through")
})
