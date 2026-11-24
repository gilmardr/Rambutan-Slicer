export type ImportDiagnostic = {
  time: string;
  version: string;
  revision?: string;
  stage: string;
  file: string;
  bytes: number;
  details: string;
};

let reports: ImportDiagnostic[] = [];
const listeners = new Set<() => void>();
export function recordImportFailure(file: File, stage: string, cause: unknown) {
  const details = cause instanceof Error ? cause.stack || cause.message : String(cause);
  reports = [{
    time: new Date().toISOString(), version: process.env.NEXT_PUBLIC_APP_VERSION || 'dev',
    revision: process.env.NEXT_PUBLIC_GIT_COMMIT || undefined, stage, file: file.name, bytes: file.size, details,
  }, ...reports].slice(0, 20);
  listeners.forEach(listener => listener());
}
export const getImportDiagnostics = () => reports;
export function subscribeImportDiagnostics(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
