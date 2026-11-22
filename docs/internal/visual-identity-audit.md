# Rambutan Slicer visual identity audit

This note records the palette and customization changes made to distinguish
Rambutan Slicer from the DragonFruit base. It is an internal comparison record, not a
user guide.

## Palette change

The previous dark theme used a plum/magenta primary accent (`#ec2a77`) and a
lime secondary accent (`#baf72e`), with a purple/pink viewport gradient. The
current Rambutan Slicer dark theme uses teal (`#3bd2c6`, button `#13a99e`) and warm
amber (`#ffb45d`, button `#e99a42`) over deep blue-green surfaces. The light
theme follows the same teal/amber identity with darker values for contrast.
The current desktop screenshot shows those colors on the Rambutan Slicer wordmark,
active Prepare tab, primary Load Mesh action and secondary Import Scene action.

Computed WCAG relative-luminance contrast ratios for the current base tokens:

| Theme | Main text / background | Muted text / background | Primary button label / fill | Secondary button label / fill |
| --- | ---: | ---: | ---: | ---: |
| Dark | 16.06:1 | 10.86:1 | 6.17:1 | 7.84:1 |
| Light | 13.81:1 | 6.20:1 | 5.48:1 | 4.83:1 |

All sampled text pairs exceed 4.5:1. The light secondary action has the
smallest margin (4.83:1), so changes to its amber token should be checked again.
These values cover the listed base pairs, not every mixed/translucent component
state in the application.

## User color control

The UI settings already support live color preview and editable custom themes.
The theme profile model covers the app surfaces, text, borders, two brand
accents, viewport background gradient, mesh selection/hover, danger/success,
and the Organic Cut palette. Users can create a named theme from a light or dark
base, save, rename, delete, import or export it. Built-in choices include the
Rambutan Slicer dark/light palette plus Concepts 3D and Atlas 3DSS. Theme files use the
versioned `dragonfruit-theme-profile` JSON envelope; the internal format id is
kept stable for existing saved preferences and exports.

The app name and current visible UI use Rambutan Slicer branding. Source identifiers
and the backwards-compatible theme format still retain DragonFruit names; those
are compatibility/history labels, not part of the visible visual identity.

## Evidence and limits

- Current tokens: `src/app/globals.css` and
  `src/components/settings/themeCustomizations.ts`.
- Custom theme UI and live preview: `src/components/settings/UISettingsTab.tsx`
  and `src/components/settings/SettingsModal.tsx`.
- The running desktop window was visually inspected on November 17, 2026 and
  showed the teal/amber theme. This check covered the welcome screen, not every
  panel, theme preset, or accessibility state.
- The WCAG ratios above were calculated from the named token pairs using the
  sRGB relative luminance formula. A full UI accessibility audit remains
  unperformed.
