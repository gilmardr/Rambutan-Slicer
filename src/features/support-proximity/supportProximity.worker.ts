import { scanSupportProximity, type SupportProximityInput, type SupportProximityWorkerResponse } from './supportProximity';

self.onmessage = (event: MessageEvent<SupportProximityInput>) => {
  try {
    self.postMessage({ report: scanSupportProximity(event.data) } satisfies SupportProximityWorkerResponse);
  } catch {
    self.postMessage({ error: true } satisfies SupportProximityWorkerResponse);
  }
};
