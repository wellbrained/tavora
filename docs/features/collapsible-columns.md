# Collapsible workspace columns

Agreed on 2026-10-24: collapse the entire outer left or right column, including every stacked panel group inside it. A column is a full-height outer section of the workspace, not an individual panel or tab.

- A header chevron folds the column into a narrow edge strip. The strip names its panels and reopens the column on click or keyboard activation.
- Other columns use the freed space. Reopening restores the previous width, subject to available space and panel minimums.
- At least one column stays open. A workspace consisting only of stacked rows has no full-height column to collapse.
- If rearranging panels moves a folded column away from an outer edge, it reopens so no panel loses its reopen strip.
- Hidden panels remain in the layout; the host stops displaying their native views. Collapsed state is stored with the workspace's layout and named layouts.
- Stacked groups have contrasting title bars and a centered resize grip in their existing gap.

Reason: occasionally needed panels should not require closing and re-adding, and repeated Planner panels need a clear visual boundary.
