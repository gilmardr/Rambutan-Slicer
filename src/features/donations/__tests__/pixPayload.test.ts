import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPixPayload, crc16Ccitt, normalizePixText } from '../pixPayload';
import { DONATION_OPTIONS, hasDonationOptions, resolveDonationOptions } from '../donationConfig';

test('crc16Ccitt matches the CRC-16/CCITT-FALSE check value', () => {
  assert.equal(crc16Ccitt('123456789'), '29B1');
});

test('crc16Ccitt reproduces the example in the Banco Central BR Code manual', () => {
  const example = '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-426655440000'
    + '5204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304';
  assert.equal(crc16Ccitt(example), '1D3D');
});

test('buildPixPayload builds a static BR Code with a valid CRC', () => {
  const payload = buildPixPayload({
    key: '123e4567-e12b-12d1-a456-426655440000',
    name: 'Fulano de Tal',
    city: 'BRASILIA',
  });
  assert.equal(
    payload,
    '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-426655440000'
      + '5204000053039865802BR5913FULANO DE TAL6008BRASILIA62070503***6304'
      + crc16Ccitt(payload.slice(0, -4)),
  );
  assert.match(payload, /6304[0-9A-F]{4}$/);
});

test('normalizePixText strips accents and limits length', () => {
  assert.equal(normalizePixText('  João Pessoa ', 15), 'JOAO PESSOA');
  assert.equal(normalizePixText('São José dos Campos', 15), 'SAO JOSE DOS CA');
});

test('buildPixPayload falls back to a default name and city', () => {
  const payload = buildPixPayload({ key: 'abc' });
  assert.ok(payload.includes('5915RAMBUTAN SLICER'));
  assert.ok(payload.includes('6006BRASIL'));
});

test('resolveDonationOptions hides empty and non-https entries', () => {
  const options = resolveDonationOptions({
    pix: { key: '  ' },
    links: [
      { id: 'a', label: 'A', url: '' },
      { id: 'b', label: 'B', url: 'http://insecure.example' },
      { id: 'c', label: 'C', url: 'https://ko-fi.com/example' },
    ],
  });
  assert.equal(options.pix, null);
  assert.deepEqual(options.links, [{ id: 'c', label: 'C', url: 'https://ko-fi.com/example' }]);
  assert.equal(hasDonationOptions(resolveDonationOptions({})), false);
});

test('the configured Pix key produces a payload', () => {
  if (!DONATION_OPTIONS.pix) return;
  assert.ok(DONATION_OPTIONS.pix.payload.includes(DONATION_OPTIONS.pix.key));
  assert.match(DONATION_OPTIONS.pix.payload, /6304[0-9A-F]{4}$/);
});
