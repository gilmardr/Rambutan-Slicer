export type RecordDelta<T> = {
  upserts: Record<string, T>;
  deleteIds: string[];
};

export function diffRecordByRef<T>(
  previous: Record<string, T>,
  next: Record<string, T>,
  forceFullSync: boolean,
): RecordDelta<T> | undefined {
  if (!forceFullSync && previous === next) return undefined;

  const upserts: Record<string, T> = {};
  const deleteIds: string[] = [];

  for (const [id, value] of Object.entries(next)) {
    if (forceFullSync || previous[id] !== value) upserts[id] = value;
  }

  for (const id of Object.keys(previous)) {
    if (!(id in next)) deleteIds.push(id);
  }

  return Object.keys(upserts).length === 0 && deleteIds.length === 0
    ? undefined
    : { upserts, deleteIds };
}

export function applyRecordDeltaInPlace<T>(target: Record<string, T>, delta?: RecordDelta<T>): void {
  if (!delta) return;

  for (const id of delta.deleteIds) delete target[id];
  for (const [id, value] of Object.entries(delta.upserts)) target[id] = value;
}
