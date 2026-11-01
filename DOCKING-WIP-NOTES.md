# WIP notes: docking drop preview (delete before the PR)

Branch t3/cc00e1bc, rebased on origin/main (0.23.50). No code written yet; research only.

## Findings (dockview-core 8.3.1, file dist/dockview-core.noStyle.js)
- moveGroupOrPanel (~l.17840): centre = remove panel, close source group if empty (gridview.remove with Sizing.Distribute), openPanel at index.
  Edge = `dropSizing` = Sizing.Split(index of reference); a single-panel source group is moved (same parent: moveView), else removed (Distribute) then re-added.
  Multi-panel source: new group created with default constraints 100x100.
- Splitview maths to copy into the pure model: addView Split (target gets floor(size/2), new gets rest), relayout/resize/distributeEmptySpace (~l.915-1250),
  distributeViewSizes = equal sizes among flexible views, clamped (so closing a group splits room equally, not proportionally).
- Margin: with n visible views, each view is size - m*(n-1)/n; view i starts at cumulativeSize_i + i*m/n; nested branch gets (size - mR, cross).
- gridview.removeView (~l.2330): when parent is left with one child, the sibling is lifted into the grandparent (branch children are spliced in) and old sizes restored.
- Outer edge: no moveTo target; prototype used api.addGroup({direction}) then moveTo into it (see prototype-code/dock-preview.ts `move`).
- vitest runs in Node without DOM, so dockview cross-checks must be Playwright/Electron e2e (apps/desktop/test/e2e/docking.spec.ts, harness.ts launch()).
- dropAllowed(api, info, data, target, position) in dock.ts only needs api.groups/getGroup(width,height,panels)/toJSON/width/height/minimumWidth/minimumHeight: the model can pass a fake api built from the layout.
- Current main WorkspacePage has no `frozen`/preview hooks the prototype diff used for stills: check host.ts (`dragging`, `frozen` exist ~l.579-610).
- Prototype: ~/Projects/Tavora/_mockups/docking/prototype-code/, worktree /Users/doki/.t3/worktrees/tavora/t3-92f2f894.
- Motion rules: docs/module-rules.md l.90 (kit tokens, transform/opacity only, <= --duration-move).

## Next
1. apps/desktop/src/renderer/dock-model.ts (+ .test.ts): tree, splitview solver, targets, refusal reasons via dropAllowed.
2. dock-preview overlay (outline, ghost tab, strips, labels EN/DE in i18n.ts), replace DropGuide/dockview tint in WorkspacePage.vue + dock.css.
3. Drop via moveTo/addGroup, dev assert vs model; e2e cross-check cases; change note in apps/desktop/changes/; screenshots/video; PR (don't merge).
No Electron was started.
