import { suggestOrientation, type AdvisorMesh, type AdvisorOptions } from './orientationAdvisor';

self.onmessage = ({ data }: MessageEvent<{ mesh: AdvisorMesh; options: AdvisorOptions }>) => {
    try {
        self.postMessage({ result: suggestOrientation(data.mesh, data.options) });
    } catch (error) {
        self.postMessage({ error: error instanceof Error ? error.message : String(error) });
    }
};
