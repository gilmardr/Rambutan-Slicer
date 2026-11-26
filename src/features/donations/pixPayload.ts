// Static Pix "BR Code" (EMV QR Code Merchant Presented Mode, as defined in the
// Banco Central do Brasil "Manual de Padrões para Iniciação do Pix").
// The same string is the "Pix copia e cola" text and the content of the QR code.
// Pure and dependency-free so both the app and scripts/generate-pix-qr.mjs can use it.

export type PixPayloadInput = {
  key: string;
  name?: string;
  city?: string;
};

const DEFAULT_NAME = 'RAMBUTAN SLICER';
const DEFAULT_CITY = 'BRASIL';

/** Uppercase ASCII only: bank apps reject accents in the name and city fields. */
export function normalizePixText(value: string, maxLength: number): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .slice(0, maxLength)
    .trim();
}

function field(id: string, value: string): string {
  return `${id}${String(value.length).padStart(2, '0')}${value}`;
}

/** CRC16-CCITT (poly 0x1021, initial 0xFFFF), as required by the BR Code spec. */
export function crc16Ccitt(text: string): string {
  let crc = 0xffff;
  for (let i = 0; i < text.length; i += 1) {
    crc ^= text.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function buildPixPayload({ key, name, city }: PixPayloadInput): string {
  const trimmedKey = key.trim();
  if (!trimmedKey) throw new Error('A Pix key is required.');
  const merchantName = normalizePixText(name ?? '', 25) || DEFAULT_NAME;
  const merchantCity = normalizePixText(city ?? '', 15) || DEFAULT_CITY;

  const body = [
    field('00', '01'),
    field('26', field('00', 'br.gov.bcb.pix') + field('01', trimmedKey)),
    field('52', '0000'),
    field('53', '986'),
    field('58', 'BR'),
    field('59', merchantName),
    field('60', merchantCity),
    field('62', field('05', '***')),
  ].join('');

  const withCrcHeader = `${body}6304`;
  return withCrcHeader + crc16Ccitt(withCrcHeader);
}
