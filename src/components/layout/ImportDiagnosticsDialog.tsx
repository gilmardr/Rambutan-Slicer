'use client';

import { useSyncExternalStore } from 'react';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Button } from '@/components/atoms';
import { StructuredDialogModal } from '@/components/ui/StructuredDialogModal';
import { getImportDiagnostics, subscribeImportDiagnostics } from '@/features/import-export/importDiagnostics';

export function ImportDiagnosticsDialog({ onClose }: { onClose: () => void }) {
  const { _ } = useLingui();
  const reports = useSyncExternalStore(subscribeImportDiagnostics, getImportDiagnostics, getImportDiagnostics);
  const title = _(msg`Import diagnostics`);
  const content = JSON.stringify(reports, null, 2);
  function save() {
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'rambutan-import-diagnostics.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  return <StructuredDialogModal open title={title} ariaLabel={title} onClose={onClose}>
    {reports.length ? <>
      <textarea readOnly aria-label={title} className="ui-input h-56 w-full font-mono text-xs" value={content} />
      <Button onClick={save}><Trans>Save report</Trans></Button>
    </> : <p><Trans>No import errors in this session.</Trans></p>}
  </StructuredDialogModal>;
}
