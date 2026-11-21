import { scanModelCollisions, type CollisionMeshInput, type CollisionWorkerResponse } from './modelCollision';

self.onmessage = (event: MessageEvent<CollisionMeshInput[]>) => {
  try {
    self.postMessage({ report: scanModelCollisions(event.data) } satisfies CollisionWorkerResponse);
  } catch {
    self.postMessage({ error: true } satisfies CollisionWorkerResponse);
  }
};
