import assert from 'node:assert/strict';
import test from 'node:test';
import { importStepOnWorker, stepImportTimeoutMs } from '../stepImportWorkerClient';

type Listener = (event: unknown) => void;

/** Stands in for the OCCT worker; `hang` makes it never answer, like OCCT stuck on a file. */
class FakeWorker {
  static created: FakeWorker[] = [];
  static hangNext = 0;
  readonly listeners = new Map<string, Listener[]>();
  readonly hang: boolean;
  terminated = false;

  constructor() {
    this.hang = FakeWorker.hangNext > 0;
    if (this.hang) FakeWorker.hangNext -= 1;
    FakeWorker.created.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  postMessage(): void {
    if (this.hang) return;
    queueMicrotask(() => {
      if (this.terminated) return;
      for (const listener of this.listeners.get('message') ?? []) {
        listener({ data: { success: true, meshes: [] } });
      }
    });
  }

  terminate(): void {
    this.terminated = true;
  }
}

(globalThis as { Worker?: unknown }).Worker = FakeWorker;

test('the time limit grows with file size and is capped', () => {
  assert.equal(stepImportTimeoutMs(0), 120_000);
  assert.equal(stepImportTimeoutMs(6 * 1024 * 1024), 180_000);
  assert.equal(stepImportTimeoutMs(500 * 1024 * 1024), 600_000);
});

test('a hung STEP import times out and the next import gets a fresh worker', async () => {
  FakeWorker.created = [];
  FakeWorker.hangNext = 1;

  const stuck = importStepOnWorker(new Uint8Array([1, 2, 3]), false, { timeoutMs: 20 });
  const next = importStepOnWorker(new Uint8Array([4, 5, 6]), false, { timeoutMs: 1_000 });

  await assert.rejects(stuck, /took longer than/);
  assert.deepEqual(await next, { success: true, meshes: [] });
  assert.equal(FakeWorker.created.length, 2);
  assert.equal(FakeWorker.created[0].terminated, true);
  assert.equal(FakeWorker.created[1].terminated, false);
});

test('a successful import keeps reusing the same worker', async () => {
  const before = FakeWorker.created.length;
  await importStepOnWorker(new Uint8Array([7]), false, { timeoutMs: 1_000 });
  await importStepOnWorker(new Uint8Array([8]), false, { timeoutMs: 1_000 });
  assert.equal(FakeWorker.created.length, before);
});
