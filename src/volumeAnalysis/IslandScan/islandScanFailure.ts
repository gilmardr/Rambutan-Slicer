export type IslandScanEngine = 'native' | 'javascript';

export interface IslandScanFailure {
  engine: IslandScanEngine;
  details: string;
}

export function createIslandScanFailure(engine: IslandScanEngine, error: unknown): IslandScanFailure {
  return {
    engine,
    details: error instanceof Error ? error.message : String(error),
  };
}
