import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import type { User } from '../src/auth.ts';
import { openDatabase } from '../src/database.ts';
import { LocalObjectStore } from '../src/object-store.ts';
import { RenderQueue } from '../src/render-queue.ts';
import { MAX_ATTEMPTS, processNextRender, type VideoRenderer } from '../src/render-worker.ts';
import { getRender, startRender } from '../src/renders.ts';

const creator: User = { id: 'user_creator', role: 'creator' };
const request = { listingId: 'listing_1', template: 'listing_tour', idempotencyKey: 'key-000001' };

function setUp(renderVideo: VideoRenderer = async () => new Uint8Array([1, 2, 3])) {
  const db = openDatabase(':memory:');
  const queue = new RenderQueue(db);
  const store = new LocalObjectStore({ rootDir: mkdtempSync(join(tmpdir(), 'objects-')), publicBaseUrl: 'http://test.local', signingSecret: 'test' });
  return { db, queue, store, renderVideo };
}

test('the same idempotency key returns the same job and queues one message', () => {
  const services = setUp();
  const first = startRender(services.db, services.queue, creator, request);
  const second = startRender(services.db, services.queue, creator, request);

  assert.equal(second.job.id, first.job.id);
  assert.deepEqual([first.isNew, second.isNew], [true, false]);
  assert.ok(services.queue.receive());
  assert.equal(services.queue.receive(), undefined);
});

test('reusing an idempotency key with a different listing is an error', () => {
  const services = setUp();
  startRender(services.db, services.queue, creator, request);
  assert.throws(() => startRender(services.db, services.queue, creator, { ...request, listingId: 'listing_2' }), /already used/);
});

test('a duplicate delivery does not render twice', async () => {
  let renderCount = 0;
  const services = setUp(async () => {
    renderCount += 1;
    return new Uint8Array([1]);
  });
  const { job } = startRender(services.db, services.queue, creator, request);
  services.queue.send({ renderJobId: job.id }); // The queue delivers the same job again.

  while (await processNextRender(services));

  assert.equal(renderCount, 1);
  const done = getRender(services.db, creator, job.id);
  assert.equal(done.status, 'succeeded');
  assert.deepEqual(await services.store.get(done.outputObjectKey!), Buffer.from([1]));
});

test('a render that keeps failing is retried, then marked failed', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  let attemptCount = 0;
  const services = setUp(async () => {
    attemptCount += 1;
    throw new Error('Chrome crashed');
  });
  const { job } = startRender(services.db, services.queue, creator, request);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    assert.equal(await processNextRender(services), true);
    t.mock.timers.tick(60_000); // Pass the retry backoff.
  }

  assert.equal(attemptCount, MAX_ATTEMPTS);
  const failed = getRender(services.db, creator, job.id);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, 'Chrome crashed');
  assert.equal(services.queue.receive(), undefined);
});
