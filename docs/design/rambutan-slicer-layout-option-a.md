# Rambutan-Slicer — Option A layout

## Decision

Implement the **vertical workflow + contextual inspector** concept. The work changes the location and presentation of the workflow navigation while keeping the existing tool rail, floating panels, printer controls, and slicing pipeline in place.

## Layout before this change

The saved state already included the command palette from the previous refactor. The workflow steps were centered in the top bar, the model tools used their existing configurable horizontal or vertical rail, and recent files were available from the command palette.

The layout before Option A is the state of `main` before the pull request that brought Option A in, so git history is the restore point.

## Option A behavior

### Workflow navigation

- Prepare, Support, Export, and Printing now appear in a vertical rail at the left edge, directly below the top bar.
- Each step keeps its existing mode callback and lock conditions. The active step is highlighted; unavailable steps remain disabled and explain why in their tooltip.
- The rail is hidden during the first-run wizard, matching the previous top-bar behavior.
- `Ctrl+K` / `Cmd+K` still opens the searchable command palette.

### Tools and contextual panels

- The model tool rail remains separate from workflow navigation. Its horizontal or vertical setting still works.
- When the model tool rail is vertical, it shifts to the right of the workflow rail.
- Floating panels reserve space for the visible rails. The model statistics card also moves clear of the rails.
- The existing mode-specific panels remain the contextual inspector: changing Prepare, Support, Export, or Printing continues to show that mode's existing tools and settings. This refactor does not add a second copy of those controls.

### Top bar

The centered workflow tabs have been removed from the top bar. The bar continues to hold the application menu, printer selection, monitor, view controls, guide, settings, and desktop window controls.

## Source map

| File | Responsibility |
| --- | --- |
| `src/components/layout/WorkflowNavigationRail.tsx` | New vertical workflow navigation, active/locked states, spacing reservation constants, and accessible labels. |
| `src/components/layout/TopBar.tsx` | Replaces the centered step row with the workflow rail; keeps global controls and command palette. |
| `src/components/controls/ToolRail.tsx` | Adds a left offset for the vertical tool rail when the workflow rail is present. |
| `src/app/page.tsx` | Computes the reserved left space for the workflow and tool rails, panel stack, and model statistics card. |
| `src/components/layout/AppCommandPalette.tsx` | Remains the searchable command and recent-file palette from the saved baseline. |

## Restore the saved layout

Revert the commit that brought Option A in (`git revert <commit>`). It touches `page.tsx`, `TopBar.tsx`, `AppCommandPalette.tsx`, `ToolRail.tsx` and adds `WorkflowNavigationRail.tsx`.

The source snapshot zip made in the local folder is not kept in the repository: it held the files from before the page.tsx refactor, so expanding it over the current code would undo that refactor.

## Scope and validation

No scene loading, model editing, slicing, export, printer communication, or print-time calculation logic was changed. The current top-bar sizing now responds to viewport width because the centered step strip no longer provides a width measurement.

Whitespace validation was run with `git diff --check`. Automated tests and a visual runtime pass were not run as part of this change.
