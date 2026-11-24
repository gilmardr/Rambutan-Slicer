import React from 'react';
import { Eraser, Paintbrush, RotateCcw, X } from 'lucide-react';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import type { MessageDescriptor } from '@lingui/core';
import { Button } from '@/components/atoms';
import { useEscapeToClose } from '@/hotkeys/useEscapeToClose';
import type { PrintIslandReport } from '@/features/slicing/tauri/nativeSlicerBridge';

export type ProcessPrintIslands = (
  minimumPixels: number,
  remove: boolean,
  onProgress: (done: number, total: number) => void,
) => Promise<PrintIslandReport>;

type PixelLayerEditorModalProps = {
  open: boolean;
  layerNumber: number;
  sourceUrl: string | null;
  previousLayerUrl: string | null;
  onClose: () => void;
  onApply: (layerNumber: number, pngBytes: Uint8Array) => Promise<void>;
  onProcessPrintIslands: ProcessPrintIslands;
};

type PixelPoint = { x: number; y: number };

const MAX_UNDO_STEPS = 5;

function formatFileIslandProgress(translate: (message: MessageDescriptor) => string, done: number, total: number): string {
  return translate(msg`Layer ${done} of ${total}`);
}

function formatFileIslandResult(
  translate: (message: MessageDescriptor) => string,
  report: PrintIslandReport,
  removed: boolean,
): string {
  const { islandCount, affectedLayers, pixelCount } = report;
  const firstAffectedLayer = report.firstAffectedLayer ?? 1;
  if (!islandCount) return translate(msg`No unsupported islands found in the CTB file.`);
  if (removed) return translate(msg`Removed ${islandCount} islands across ${affectedLayers} layers (${pixelCount} pixels).`);
  return translate(msg`Found ${islandCount} islands across ${affectedLayers} layers (${pixelCount} pixels). First affected layer: ${firstAffectedLayer}.`);
}

function imageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load the layer image.'));
    image.src = url;
  });
}

function isLit(imageData: ImageData, pixelIndex: number): boolean {
  const offset = pixelIndex * 4;
  return imageData.data[offset + 3] > 0 && imageData.data[offset] > 0;
}

export function PixelLayerEditorModal({
  open,
  layerNumber,
  sourceUrl,
  previousLayerUrl,
  onClose,
  onApply,
  onProcessPrintIslands,
}: PixelLayerEditorModalProps) {
  const { _ } = useLingui();
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const undoStackRef = React.useRef<ImageData[]>([]);
  const drawingRef = React.useRef(false);
  const lastPointRef = React.useRef<PixelPoint | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const [tool, setTool] = React.useState<'paint' | 'erase'>('paint');
  const [brushSize, setBrushSize] = React.useState(1);
  const [minimumIslandPixels, setMinimumIslandPixels] = React.useState(1);
  const [isApplying, setIsApplying] = React.useState(false);
  const [isRemovingIslands, setIsRemovingIslands] = React.useState(false);
  const [fileIslandAction, setFileIslandAction] = React.useState<'scan' | 'remove' | null>(null);
  const [fileIslandProgress, setFileIslandProgress] = React.useState<[number, number] | null>(null);
  const [fileIslandResult, setFileIslandResult] = React.useState<{ report: PrintIslandReport; removed: boolean } | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const isBusy = isApplying || isRemovingIslands || fileIslandAction !== null;

  React.useEffect(() => {
    if (!open) setFileIslandResult(null);
  }, [open]);

  React.useEffect(() => {
    if (!open || !sourceUrl) return;
    let cancelled = false;
    setLoaded(false);
    setDirty(false);
    setError(null);
    setMessage(null);
    undoStackRef.current = [];

    void imageFromUrl(sourceUrl).then((image) => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      const context = canvas?.getContext('2d', { willReadFrequently: true });
      if (!canvas || !context) {
        setError(_(msg`Could not create the pixel editor.`));
        return;
      }
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      context.imageSmoothingEnabled = false;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0);
      setLoaded(true);
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
    });

    return () => {
      cancelled = true;
    };
  }, [_, open, sourceUrl]);

  useEscapeToClose(open, isBusy ? undefined : onClose);

  const saveUndoPoint = React.useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d', { willReadFrequently: true });
    if (!canvas || !context) return;
    const snapshot = context.getImageData(0, 0, canvas.width, canvas.height);
    const stack = undoStackRef.current;
    stack.push(snapshot);
    if (stack.length > MAX_UNDO_STEPS) stack.shift();
  }, []);

  const pixelPointFromEvent = React.useCallback((event: React.PointerEvent<HTMLCanvasElement>): PixelPoint | null => {
    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    if (!canvas || !rect || rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: Math.max(0, Math.min(canvas.width - 1, Math.floor((event.clientX - rect.left) * canvas.width / rect.width))),
      y: Math.max(0, Math.min(canvas.height - 1, Math.floor((event.clientY - rect.top) * canvas.height / rect.height))),
    };
  }, []);

  const paintPoint = React.useCallback((point: PixelPoint) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d', { willReadFrequently: true });
    if (!canvas || !context) return;
    const half = Math.floor(brushSize / 2);
    context.fillStyle = tool === 'paint' ? '#ffffff' : '#000000';
    context.fillRect(
      Math.max(0, Math.min(canvas.width - brushSize, point.x - half)),
      Math.max(0, Math.min(canvas.height - brushSize, point.y - half)),
      brushSize,
      brushSize,
    );
  }, [brushSize, tool]);

  const handlePointerDown = React.useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!loaded || isBusy) return;
    const point = pixelPointFromEvent(event);
    if (!point) return;
    saveUndoPoint();
    drawingRef.current = true;
    lastPointRef.current = point;
    event.currentTarget.setPointerCapture(event.pointerId);
    paintPoint(point);
    setDirty(true);
    setFileIslandResult(null);
    setMessage(null);
  }, [isBusy, loaded, paintPoint, pixelPointFromEvent, saveUndoPoint]);

  const handlePointerMove = React.useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const next = pixelPointFromEvent(event);
    const previous = lastPointRef.current;
    if (!next || !previous) return;
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    const steps = Math.max(Math.abs(dx), Math.abs(dy));
    for (let step = 1; step <= steps; step += 1) {
      paintPoint({
        x: Math.round(previous.x + dx * step / steps),
        y: Math.round(previous.y + dy * step / steps),
      });
    }
    lastPointRef.current = next;
    setDirty(true);
  }, [paintPoint, pixelPointFromEvent]);

  const finishStroke = React.useCallback(() => {
    drawingRef.current = false;
    lastPointRef.current = null;
  }, []);

  const handleUndo = React.useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d', { willReadFrequently: true });
    const previous = undoStackRef.current.pop();
    if (!canvas || !context || !previous) return;
    context.putImageData(previous, 0, 0);
    setDirty(true);
    setMessage(null);
  }, []);

  const handleRemoveIslands = React.useCallback(async () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d', { willReadFrequently: true });
    if (!canvas || !context || !previousLayerUrl || layerNumber <= 1) return;
    if (canvas.width * canvas.height > 40_000_000) {
      setError(_(msg`This layer is too large for island removal in the editor.`));
      return;
    }

    setIsRemovingIslands(true);
    setError(null);
    setMessage(null);
    try {
      const previousImage = await imageFromUrl(previousLayerUrl);
      if (previousImage.naturalWidth !== canvas.width || previousImage.naturalHeight !== canvas.height) {
        throw new Error(_(msg`Adjacent layer dimensions do not match.`));
      }
      const previousCanvas = document.createElement('canvas');
      previousCanvas.width = canvas.width;
      previousCanvas.height = canvas.height;
      const previousContext = previousCanvas.getContext('2d', { willReadFrequently: true });
      if (!previousContext) throw new Error(_(msg`Could not read the adjacent layer.`));
      previousContext.imageSmoothingEnabled = false;
      previousContext.drawImage(previousImage, 0, 0);

      const current = context.getImageData(0, 0, canvas.width, canvas.height);
      const previous = previousContext.getImageData(0, 0, canvas.width, canvas.height);
      const pixelCount = canvas.width * canvas.height;
      const visited = new Uint8Array(pixelCount);
      const queue = new Uint32Array(pixelCount);
      let removedRegions = 0;
      let removedPixels = 0;

      for (let seed = 0; seed < pixelCount; seed += 1) {
        if (visited[seed] || !isLit(current, seed)) continue;
        let head = 0;
        let tail = 0;
        let touchesPreviousLayer = false;
        queue[tail++] = seed;
        visited[seed] = 1;

        while (head < tail) {
          const pixel = queue[head++];
          if (isLit(previous, pixel)) touchesPreviousLayer = true;
          const x = pixel % canvas.width;
          const y = Math.floor(pixel / canvas.width);
          for (let dy = -1; dy <= 1; dy += 1) {
            const ny = y + dy;
            if (ny < 0 || ny >= canvas.height) continue;
            for (let dx = -1; dx <= 1; dx += 1) {
              if (dx === 0 && dy === 0) continue;
              const nx = x + dx;
              if (nx < 0 || nx >= canvas.width) continue;
              const neighbour = ny * canvas.width + nx;
              if (visited[neighbour] || !isLit(current, neighbour)) continue;
              visited[neighbour] = 1;
              queue[tail++] = neighbour;
            }
          }
        }

        if (touchesPreviousLayer || tail < minimumIslandPixels) continue;
        removedRegions += 1;
        removedPixels += tail;
        for (let index = 0; index < tail; index += 1) {
          const offset = queue[index] * 4;
          current.data[offset] = 0;
          current.data[offset + 1] = 0;
          current.data[offset + 2] = 0;
          current.data[offset + 3] = 255;
        }
      }

      if (removedPixels > 0) {
        saveUndoPoint();
        context.putImageData(current, 0, 0);
        setDirty(true);
        setFileIslandResult(null);
      }
      setMessage(removedRegions > 0
        ? _(msg`Removed ${removedRegions} islands (${removedPixels} pixels).`)
        : _(msg`No unsupported islands found on this layer.`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsRemovingIslands(false);
    }
  }, [_, layerNumber, minimumIslandPixels, previousLayerUrl, saveUndoPoint]);

  const handleProcessFileIslands = async (remove: boolean) => {
    if (isBusy || dirty) return;
    setFileIslandAction(remove ? 'remove' : 'scan');
    setFileIslandProgress(null);
    setFileIslandResult(null);
    setError(null);
    setMessage(null);
    try {
      const report = await onProcessPrintIslands(minimumIslandPixels, remove, (done, total) => {
        setFileIslandProgress([done, total]);
      });
      setFileIslandResult({ report, removed: remove });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setFileIslandAction(null);
    }
  };

  const handleApply = React.useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !dirty || !loaded || isApplying) return;
    setIsApplying(true);
    setError(null);
    try {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error(_(msg`Could not encode the edited layer.`));
      await onApply(layerNumber, new Uint8Array(await blob.arrayBuffer()));
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsApplying(false);
    }
  }, [_, dirty, isApplying, layerNumber, loaded, onApply, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/75 p-4" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !isBusy) onClose();
    }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pixel-layer-editor-title"
        className="flex max-h-[94vh] w-[min(1100px,96vw)] flex-col overflow-hidden rounded-xl border shadow-2xl"
        style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-0)', color: 'var(--text-strong)' }}
      >
        <header className="flex items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: 'var(--border-subtle)' }}>
          <div>
            <h2 id="pixel-layer-editor-title" className="text-sm font-semibold">{_(msg`Edit layer pixels`)}</h2>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{_(msg`Layer ${layerNumber}`)}</p>
          </div>
          <button type="button" className="rounded p-1.5" aria-label={_(msg`Close`)} disabled={isBusy} onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2" style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}>
          <Button variant={tool === 'paint' ? 'accent' : 'secondary'} size="auto" className="!h-8 gap-1.5 px-2.5" onClick={() => setTool('paint')} disabled={!loaded || isBusy}>
            <Paintbrush className="h-3.5 w-3.5" />{_(msg`Paint`)}
          </Button>
          <Button variant={tool === 'erase' ? 'accent' : 'secondary'} size="auto" className="!h-8 gap-1.5 px-2.5" onClick={() => setTool('erase')} disabled={!loaded || isBusy}>
            <Eraser className="h-3.5 w-3.5" />{_(msg`Erase`)}
          </Button>
          <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
            {_(msg`Brush size`)}
            <select value={brushSize} disabled={isBusy} onChange={(event) => setBrushSize(Number(event.target.value))} className="rounded border px-2 py-1" style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-0)', color: 'var(--text-strong)' }}>
              {[1, 3, 5, 9].map((size) => <option key={size} value={size}>{size} px</option>)}
            </select>
          </label>
          <Button variant="secondary" size="auto" className="!h-8 gap-1.5 px-2.5" onClick={handleUndo} disabled={!loaded || undoStackRef.current.length === 0 || isBusy}>
            <RotateCcw className="h-3.5 w-3.5" />{_(msg`Undo`)}
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {_(msg`Minimum island area`)}
              <input type="number" min={1} max={500} step={1} value={minimumIslandPixels} disabled={isBusy} onChange={(event) => {
                setMinimumIslandPixels(Math.max(1, Math.min(500, Math.floor(Number(event.target.value) || 1))));
                setFileIslandResult(null);
              }} className="w-16 rounded border px-2 py-1" style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-0)', color: 'var(--text-strong)' }} />
              px
            </label>
            <Button variant="secondary" size="auto" className="!h-8 px-2.5" onClick={() => { void handleRemoveIslands(); }} disabled={!loaded || !previousLayerUrl || layerNumber <= 1 || isBusy}>
              {isRemovingIslands ? _(msg`Removing…`) : _(msg`Remove islands on this layer`)}
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4" style={{ background: '#17191f' }}>
          {!loaded && !error && <div className="text-sm" style={{ color: 'var(--text-muted)' }}>{_(msg`Loading layer…`)}</div>}
          <canvas
            ref={canvasRef}
            className="max-h-[68vh] max-w-full touch-none border border-white/20"
            style={{ imageRendering: 'pixelated', cursor: tool === 'paint' ? 'crosshair' : 'cell', display: loaded ? 'block' : 'none' }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishStroke}
            onPointerCancel={finishStroke}
            onLostPointerCapture={finishStroke}
          />
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="min-w-0 flex-1 text-xs" style={{ color: error ? 'var(--danger)' : 'var(--text-muted)' }} aria-live="polite">
            {error ?? (fileIslandAction
              ? fileIslandProgress
                ? formatFileIslandProgress(_, ...fileIslandProgress)
                : _(msg`Opening CTB file…`)
              : fileIslandResult
                ? formatFileIslandResult(_, fileIslandResult.report, fileIslandResult.removed)
                : message ?? _(msg`Paint or erase pixels, then apply the edit to the CTB file.`))}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="secondary" size="auto" className="!h-9 px-3" onClick={() => { void handleProcessFileIslands(false); }} disabled={dirty || isBusy}>
              {fileIslandAction === 'scan' ? _(msg`Scanning all layers…`) : _(msg`Scan all layers`)}
            </Button>
            {fileIslandResult && !fileIslandResult.removed && fileIslandResult.report.islandCount > 0 && (
              <Button variant="primary" size="auto" className="!h-9 px-3" onClick={() => { void handleProcessFileIslands(true); }} disabled={dirty || isBusy}>
                {_(msg`Remove all islands and save`)}
              </Button>
            )}
            <Button variant="secondary" size="auto" className="!h-9 px-3" onClick={onClose} disabled={isBusy}>{_(msg`Close`)}</Button>
            <Button variant="primary" size="auto" className="!h-9 px-3" onClick={() => { void handleApply(); }} disabled={!dirty || !loaded || isBusy}>
              {isApplying ? _(msg`Applying…`) : _(msg`Apply to file`)}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
