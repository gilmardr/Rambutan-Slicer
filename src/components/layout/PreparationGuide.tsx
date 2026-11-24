'use client';

import { useEffect, useRef, useState } from 'react';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { ArrowRight, BookOpen, Box, Download, Droplets, Layers, Rotate3D } from 'lucide-react';
import Image from 'next/image';
import { Button } from '@/components/atoms';
import { AutoSupportIcon, IslandPalmIcon } from '@/components/controls/ToolRail';
import { StructuredDialogModal } from '@/components/ui/StructuredDialogModal';

const steps = {
  import: {
    label: msg({ id: 'prepGuide.import', message: 'Import' }),
    tip: msg({ id: 'prepGuide.importTip', message: 'Open a model and check its dimensions against the build plate. This is especially useful when importing a part from CAD.' }),
    action: msg({ id: 'prepGuide.importAction', message: 'Import model' }),
    image: 'step.webp',
    icon: Box,
  },
  orient: {
    label: msg({ id: 'prepGuide.orient', message: 'Orient' }),
    tip: msg({ id: 'prepGuide.orientTip', message: 'Select the model and use Transform to try an angle that avoids large flat layers. Keep important surfaces away from support contacts.' }),
    action: msg({ id: 'prepGuide.orientAction', message: 'Open Transform' }),
    image: 'orientation.webp',
    icon: Rotate3D,
  },
  hollow: {
    label: msg({ id: 'prepGuide.hollow', message: 'Hollow and drain' }),
    tip: msg({ id: 'prepGuide.hollowTip', message: 'For a bulky part, hollowing can save resin. Add drainage and vent holes, then verify that they reach the cavity. Skip this step if the part should stay solid.' }),
    action: msg({ id: 'prepGuide.hollowAction', message: 'Open Hollow' }),
    image: 'hollow.webp',
    icon: Droplets,
  },
  supports: {
    label: msg({ id: 'prepGuide.supports', message: 'Add supports' }),
    tip: msg({ id: 'prepGuide.supportsTip', message: 'Once the orientation is set, generate automatic supports as a starting point. Inspect their contacts and add manual supports where needed.' }),
    action: msg({ id: 'prepGuide.supportsAction', message: 'Open Automatic Supports' }),
    image: 'supports.webp',
    icon: AutoSupportIcon,
  },
  islands: {
    label: msg({ id: 'prepGuide.islands', message: 'Review islands' }),
    tip: msg({ id: 'prepGuide.islandsTip', message: 'Scan for regions that start printing with nothing below them. Add missing supports and run the check again before slicing.' }),
    action: msg({ id: 'prepGuide.islandsAction', message: 'Open Islands' }),
    image: 'diagnostics.webp',
    icon: IslandPalmIcon,
  },
  slice: {
    label: msg({ id: 'prepGuide.slice', message: 'Slice' }),
    tip: msg({ id: 'prepGuide.sliceTip', message: 'Check the printer and material profiles. In Export, choose Just Slice to inspect the layers before saving the print file.' }),
    action: msg({ id: 'prepGuide.exportAction', message: 'Open Export' }),
    image: 'camadas-relevo.png',
    icon: Layers,
  },
  export: {
    label: msg({ id: 'prepGuide.export', message: 'Export' }),
    tip: msg({ id: 'prepGuide.exportTip', message: 'After reviewing the layers, download the sliced file from Printing, or use Slice to File in Export. Check that the file format matches your printer.' }),
    action: msg({ id: 'prepGuide.exportAction', message: 'Open Export' }),
    image: 'camadas-relevo.png',
    icon: Download,
  },
};

export type PreparationStep = keyof typeof steps;
const stepOrder = Object.keys(steps) as PreparationStep[];

interface PreparationGuideProps {
  initialStep: PreparationStep;
  hasModels: boolean;
  canPreview: boolean;
  onClose: () => void;
  onOpenTool: (step: PreparationStep) => void;
}

export function PreparationGuide({ initialStep, hasModels, canPreview, onClose, onOpenTool }: PreparationGuideProps) {
  const { _ } = useLingui();
  const [selected, setSelected] = useState(initialStep);
  const stepsRef = useRef<HTMLOListElement>(null);
  const step = steps[selected];
  const nextStep = stepOrder[stepOrder.indexOf(selected) + 1];
  const title = _(msg({ id: 'prepGuide.title', message: 'Preparation guide' }));

  useEffect(() => {
    const origin = document.activeElement;
    stepsRef.current?.querySelector<HTMLButtonElement>('[aria-current="step"]')?.focus();
    return () => {
      if (origin instanceof HTMLElement && origin.isConnected) origin.focus();
    };
  }, []);

  return (
    <StructuredDialogModal
      open
      ariaLabel={title}
      title={title}
      icon={<BookOpen className="h-4 w-4" />}
      iconTone="accent"
      closeAriaLabel={_(msg({ id: 'prepGuide.close', message: 'Close preparation guide' }))}
      onClose={onClose}
      maxWidthClassName="max-w-3xl"
      panelClassName="flex max-h-[calc(100dvh-1.5rem)] flex-col"
      bodyClassName="min-h-0 overflow-y-auto p-4 sm:p-5"
    >
      <div className="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
        <ol ref={stepsRef} className="flex flex-wrap content-start gap-1.5 sm:flex-col" aria-label={title}>
          {stepOrder.map((id, index) => {
            const { icon: Icon, label } = steps[id];
            return (
              <li key={id}>
                <Button
                  type="button"
                  variant={selected === id ? 'tinted-accent' : 'secondary'}
                  aria-current={selected === id ? 'step' : undefined}
                  className="flex w-full items-center justify-start gap-2 text-left"
                  onClick={() => setSelected(id)}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{index + 1}. {_(label)}</span>
                </Button>
              </li>
            );
          })}
        </ol>

        <section className="min-w-0 space-y-3" aria-live="polite">
          <h3 className="text-base font-semibold" style={{ color: 'var(--text-strong)' }}>{_(step.label)}</h3>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>{_(step.tip)}</p>

          <figure className="space-y-1.5">
            <div className="relative h-[clamp(8rem,32dvh,16rem)] w-full overflow-hidden rounded-lg border" style={{ background: 'var(--surface-1)', borderColor: 'var(--border-subtle)' }}>
              <Image key={step.image} src={`/preparation-guide/${step.image}`} alt="" fill unoptimized loading="eager" className="object-contain" />
            </div>
            <figcaption className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {selected === 'slice' || selected === 'export'
                ? _(msg({ id: 'prepGuide.layerExample', message: 'Example of the layer preview in Rambutan Slicer.' }))
                : _(msg({ id: 'prepGuide.astronautExample', message: 'Illustrated example: preparing an astronaut model.' }))}
            </figcaption>
          </figure>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="primary" onClick={() => onOpenTool(hasModels ? selected : 'import')}>
              {hasModels || selected === 'import'
                ? selected === 'export' && canPreview
                  ? _(msg({ id: 'prepGuide.previewAction', message: 'Open print preview' }))
                  : _(step.action)
                : _(steps.import.action)}
            </Button>
            {nextStep && (
              <Button type="button" variant="secondary" className="inline-flex items-center gap-1.5" onClick={() => setSelected(nextStep)}>
                {_(msg({ id: 'prepGuide.next', message: 'Next step' }))}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            )}
          </div>
        </section>
      </div>
    </StructuredDialogModal>
  );
}
