import { detectSuctionCups, type SuctionCupWorkerResponse } from './suctionCupDetection';
import type { CollisionMeshInput } from '@/features/model-collision/modelCollision';

self.onmessage = (event: MessageEvent<CollisionMeshInput>) => {
  try {
    const report = detectSuctionCups(event.data);
    if (!report) {
      self.postMessage({ error: true } satisfies SuctionCupWorkerResponse);
      return;
    }
    const transfer = report.findings.map((finding) => finding.surfacePoints.buffer as ArrayBuffer);
    const workerScope = self as unknown as { postMessage(message: unknown, transfer: Transferable[]): void };
    workerScope.postMessage({ report } satisfies SuctionCupWorkerResponse, transfer);
  } catch {
    self.postMessage({ error: true } satisfies SuctionCupWorkerResponse);
  }
};
