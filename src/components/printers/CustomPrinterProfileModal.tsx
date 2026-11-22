'use client';

import React from 'react';
import { Trans } from '@lingui/react/macro';
import { Button } from '@/components/atoms';
import { getAvailableFormatVersionOptions } from '@/features/slicing/formats/registry';
import type { PrinterProfile } from '@/features/profiles/profileStore';
import { RESIN_PRINTER_MANUFACTURERS } from '@/features/profiles/printerManufacturers';

export type CustomPrinterProfileDraft = Pick<
  PrinterProfile,
  'manufacturer' | 'name' | 'buildVolumeMm' | 'display'
>;

type FormatOption = {
  value: string;
  label: string;
};

type Props = {
  initialManufacturer?: string;
  initialModel?: string;
  initialOutputFormat?: string;
  formats: FormatOption[];
  onCancel: () => void;
  onCreate: (draft: CustomPrinterProfileDraft) => void;
};

function positiveNumber(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export default function CustomPrinterProfileModal({
  initialManufacturer = '',
  initialModel = '',
  initialOutputFormat = '',
  formats,
  onCancel,
  onCreate,
}: Props) {
  const [manufacturer, setManufacturer] = React.useState(initialManufacturer);
  const [modelName, setModelName] = React.useState(initialModel);
  const [outputFormat, setOutputFormat] = React.useState(() => (
    formats.some((format) => format.value === initialOutputFormat) ? initialOutputFormat : ''
  ));
  const [formatVersion, setFormatVersion] = React.useState('');
  const [width, setWidth] = React.useState('');
  const [depth, setDepth] = React.useState('');
  const [height, setHeight] = React.useState('');
  const [resolutionX, setResolutionX] = React.useState('');
  const [resolutionY, setResolutionY] = React.useState('');

  const formatVersionOptions = React.useMemo(
    () => getAvailableFormatVersionOptions(outputFormat),
    [outputFormat],
  );

  React.useEffect(() => {
    const defaultVersion = formatVersionOptions.find((option) => option.isDefault)
      ?? formatVersionOptions[0];
    setFormatVersion(defaultVersion?.value ?? '');
  }, [formatVersionOptions]);

  const parsedWidth = positiveNumber(width);
  const parsedDepth = positiveNumber(depth);
  const parsedHeight = positiveNumber(height);
  const parsedResolutionX = positiveNumber(resolutionX);
  const parsedResolutionY = positiveNumber(resolutionY);
  const canCreate = manufacturer.trim().length > 0
    && modelName.trim().length > 0
    && formats.some((format) => format.value === outputFormat)
    && parsedWidth !== null
    && parsedDepth !== null
    && parsedHeight !== null
    && parsedResolutionX !== null
    && parsedResolutionY !== null
    && Number.isInteger(parsedResolutionX)
    && Number.isInteger(parsedResolutionY);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      !canCreate
      || parsedWidth === null
      || parsedDepth === null
      || parsedHeight === null
      || parsedResolutionX === null
      || parsedResolutionY === null
    ) {
      return;
    }

    onCreate({
      manufacturer: manufacturer.trim(),
      name: modelName.trim(),
      buildVolumeMm: {
        width: parsedWidth,
        depth: parsedDepth,
        height: parsedHeight,
      },
      display: {
        resolutionX: parsedResolutionX,
        resolutionY: parsedResolutionY,
        outputFormat: outputFormat as PrinterProfile['display']['outputFormat'],
        formatVersion: formatVersion || undefined,
      },
    });
  };

  const numberField = (
    label: React.ReactNode,
    value: string,
    setValue: (next: string) => void,
    step: string,
  ) => (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <input
        type="number"
        min="0.01"
        step={step}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        required
        className="ui-input w-full h-9 text-sm"
      />
    </label>
  );

  return (
    <div
      className="fixed inset-0 z-[75] flex items-center justify-center bg-black/60 p-4 ui-modal-backdrop-enter"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        onSubmit={handleSubmit}
        className="w-full max-w-2xl rounded-xl border shadow-2xl overflow-hidden ui-modal-panel-enter"
        style={{ borderColor: 'var(--border-strong)', background: 'var(--surface-0)' }}
      >
        <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text-strong)' }}>
            <Trans>Create a custom printer profile</Trans>
          </h2>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            <Trans>Enter the specifications from your printer manual. Only formats with an installed encoder can be selected.</Trans>
          </p>
        </div>

        <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                <Trans>Manufacturer</Trans>
              </span>
              <input
                list="rambutan-slicer-printer-manufacturers"
                value={manufacturer}
                onChange={(event) => setManufacturer(event.target.value)}
                required
                className="ui-input w-full h-9 text-sm"
              />
              <datalist id="rambutan-slicer-printer-manufacturers">
                {RESIN_PRINTER_MANUFACTURERS.map((name) => <option key={name} value={name} />)}
              </datalist>
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                <Trans>Printer model</Trans>
              </span>
              <input
                value={modelName}
                onChange={(event) => setModelName(event.target.value)}
                required
                className="ui-input w-full h-9 text-sm"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                <Trans>Output format</Trans>
              </span>
              <select
                value={outputFormat}
                onChange={(event) => setOutputFormat(event.target.value)}
                required
                className="ui-input w-full h-9 text-sm"
              >
                <option value="" disabled><Trans>Select an installed format</Trans></option>
                {formats.map((format) => (
                  <option key={format.value} value={format.value}>{format.label} ({format.value})</option>
                ))}
              </select>
            </label>

            {formatVersionOptions.length > 0 && (
              <label className="block space-y-1.5">
                <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                  <Trans>Format version</Trans>
                </span>
                <select
                  value={formatVersion}
                  onChange={(event) => setFormatVersion(event.target.value)}
                  className="ui-input w-full h-9 text-sm"
                >
                  {formatVersionOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold" style={{ color: 'var(--text-strong)' }}>
              <Trans>Build volume (mm)</Trans>
            </legend>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {numberField(<Trans>Width</Trans>, width, setWidth, '0.01')}
              {numberField(<Trans>Depth</Trans>, depth, setDepth, '0.01')}
              {numberField(<Trans>Height</Trans>, height, setHeight, '0.01')}
            </div>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold" style={{ color: 'var(--text-strong)' }}>
              <Trans>Screen resolution (pixels)</Trans>
            </legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {numberField(<Trans>Resolution X</Trans>, resolutionX, setResolutionX, '1')}
              {numberField(<Trans>Resolution Y</Trans>, resolutionY, setResolutionY, '1')}
            </div>
          </fieldset>

          <p className="rounded-md border p-2.5 text-xs" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)', background: 'var(--surface-1)' }}>
            <Trans>Wrong dimensions, resolution, or format version can produce an invalid print file. Confirm these values for the exact model and firmware.</Trans>
          </p>
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t" style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}>
          <Button type="button" variant="secondary" size="auto" className="!h-9 !px-3 !py-0 text-sm" onClick={onCancel}>
            <Trans>Cancel</Trans>
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="auto"
            className="!h-9 !px-3 !py-0 text-sm"
            aria-disabled={!canCreate}
            onClick={(event) => {
              if (!canCreate) event.preventDefault();
            }}
          >
            <Trans>Create profile</Trans>
          </Button>
        </div>
      </form>
    </div>
  );
}