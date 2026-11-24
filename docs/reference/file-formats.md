# File Formats Reference

DragonFruit works with both scene and geometry formats.

## VOXL (`.voxl`)

Native DragonFruit scene format.

- Stores scene metadata, model transforms, supports, and optional extensions.
- Uses the binary chunk container (compat floor `2`, or `3` when identical geometry is shared between models).
- The obsolete V1 JSON profile is no longer read; opening such a file reports that it was saved by an unsupported version.

## STL

Primary mesh import/export format for geometry workflows.

- Used for model ingestion and print-ready mesh exchange.
- Export path includes support/raft geometry when configured.

## STEP (.step, .stp)

STEP CAD files can be opened as models. Their surfaces are tessellated into one triangle mesh in millimeters for positioning, repair, and slicing; the original CAD feature tree is not retained.

## 3MF (`.3mf`)

Supported export format for model + support workflows.

- Available as an export target alongside STL and VOXL.
- Useful when you want a packaged manufacturing-ready artifact.

## LYS (`.lys`) import path

Lychee scene import is supported through the built-in LYS plugin integration.

- Geometry extracted from binary mesh payloads.
- Scene transform and support reconstruction mapped into DragonFruit structures.

For implementation details, see [Developer Formats](../dev/formats.md).
