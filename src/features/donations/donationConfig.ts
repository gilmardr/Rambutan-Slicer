import rawConfig from '@/config/donations.json';
import { buildPixPayload } from './pixPayload';

export type DonationLink = { id: string; label: string; url: string };

export type DonationOptions = {
  /** `payload` is the "Pix copia e cola" text for the configured key. */
  pix: { key: string; payload: string } | null;
  links: DonationLink[];
};

type RawConfig = {
  pix?: { key?: string; name?: string; city?: string };
  links?: Array<{ id?: string; label?: string; url?: string }>;
};

export function resolveDonationOptions(config: RawConfig): DonationOptions {
  const key = config.pix?.key?.trim() ?? '';
  const pix = key
    ? {
      key,
      payload: buildPixPayload({ key, name: config.pix?.name, city: config.pix?.city }),
    }
    : null;

  const links = (config.links ?? [])
    .map((link) => ({ id: link.id?.trim() ?? '', label: link.label?.trim() ?? '', url: link.url?.trim() ?? '' }))
    .filter((link) => link.id && link.label && /^https:\/\//.test(link.url));

  return { pix, links };
}

export const DONATION_OPTIONS: DonationOptions = resolveDonationOptions(rawConfig as RawConfig);

export function hasDonationOptions(options: DonationOptions = DONATION_OPTIONS): boolean {
  return options.pix !== null || options.links.length > 0;
}
