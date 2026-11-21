import { CHITUBOX_PRINTER_MANUFACTURERS } from './chituboxPrinterCatalog';

/**
 * Suggested manufacturers in the printer library. Listing a manufacturer does
 * not imply that every model or file format has an installed output encoder.
 */
export const RESIN_PRINTER_MANUFACTURERS = Array.from(new Set([
  ...CHITUBOX_PRINTER_MANUFACTURERS,
  'Concepts3D',
  'Generic',
])).sort((a, b) => a.localeCompare(b));