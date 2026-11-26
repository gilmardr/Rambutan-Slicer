'use client';

import React from 'react';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Check, Copy, ExternalLink, Heart } from 'lucide-react';
import { DONATION_OPTIONS, hasDonationOptions } from '@/features/donations/donationConfig';

async function openExternal(url: string): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_external_url', { url });
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}

type CopyTarget = 'key' | 'payload';

/** "Support Rambutan" box in Settings > About: Pix key, Pix copia e cola and other donation links. */
export function SupportRambutanCard() {
  const { _ } = useLingui();
  const [copied, setCopied] = React.useState<CopyTarget | null>(null);
  const resetTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, []);

  if (!hasDonationOptions()) return null;
  const { pix, links } = DONATION_OPTIONS;

  const copy = async (target: CopyTarget, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(target);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(null), 2000);
    } catch { /* clipboard unavailable */ }
  };

  const chipStyle: React.CSSProperties = {
    borderColor: 'color-mix(in srgb, var(--accent), var(--border-subtle) 55%)',
    background: 'color-mix(in srgb, var(--surface-1), transparent 8%)',
    color: 'var(--text-strong)',
  };

  return (
    <section
      id="support-rambutan"
      className="rounded-xl border px-4 py-3"
      style={{
        borderColor: 'color-mix(in srgb, var(--accent), var(--border-subtle) 50%)',
        background: 'color-mix(in srgb, var(--accent), var(--surface-0) 93%)',
      }}
    >
      <div className="flex items-center gap-2">
        <Heart className="h-4 w-4 shrink-0" style={{ color: 'var(--accent)' }} />
        <h5 className="text-sm font-semibold" style={{ color: 'var(--text-strong)' }}>
          <Trans>Support Rambutan</Trans>
        </h5>
      </div>
      <p className="mt-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
        <Trans>Rambutan Slicer is free and open source. Donations help pay for development, test printers and resin. Any amount helps.</Trans>
      </p>

      {pix && (
        <div className="mt-2.5 space-y-1.5">
          <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
            {_(msg({ message: 'Pix (Brazil)', comment: 'Pix is the Brazilian instant payment system; keep the name "Pix".' }))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <code
              className="min-w-0 flex-1 truncate rounded-md border px-2 py-1 font-mono text-[12px]"
              style={chipStyle}
              title={pix.key}
            >
              {pix.key}
            </code>
            <button
              type="button"
              onClick={() => { void copy('key', pix.key); }}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[12px] font-semibold"
              style={chipStyle}
            >
              {copied === 'key' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied === 'key' ? _(msg`Copied!`) : _(msg`Copy key`)}
            </button>
            <button
              type="button"
              onClick={() => { void copy('payload', pix.payload); }}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[12px] font-semibold"
              style={chipStyle}
              title={_(msg({ message: 'Copies the full Pix code to paste in your bank app', comment: '"Pix copia e cola" code.' }))}
            >
              {copied === 'payload' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied === 'payload'
                ? _(msg`Copied!`)
                : _(msg({ message: 'Copy Pix code', comment: 'The "Pix copia e cola" code. In pt-BR use "Pix copia e cola".' }))}
            </button>
          </div>
        </div>
      )}

      {links.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {links.map((link) => (
            <button
              key={link.id}
              type="button"
              onClick={() => { void openExternal(link.url); }}
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[12px] font-semibold"
              style={chipStyle}
            >
              {link.label}
              <ExternalLink className="h-3 w-3" />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
