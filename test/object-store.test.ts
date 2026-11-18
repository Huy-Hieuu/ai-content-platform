import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { LocalObjectStore } from '../src/object-store.ts';

const store = new LocalObjectStore({ rootDir: mkdtempSync(join(tmpdir(), 'objects-')), publicBaseUrl: 'http://test.local', signingSecret: 'test' });

test('a signed URL is valid only for its own key and only until it expires', () => {
  const url = new URL(store.signedUrl('renders/a.mp4', 60));
  const expiresAt = Number(url.searchParams.get('expires'));
  const signature = url.searchParams.get('signature')!;

  assert.equal(store.isValidSignature('renders/a.mp4', expiresAt, signature), true);
  assert.equal(store.isValidSignature('renders/b.mp4', expiresAt, signature), false);
  assert.equal(store.isValidSignature('renders/a.mp4', expiresAt + 1, signature), false);
  assert.equal(store.isValidSignature('renders/a.mp4', Math.floor(Date.now() / 1000) - 1, signature), false);
});

test('a key cannot escape the storage directory', async () => {
  await assert.rejects(store.put('../outside.txt', 'x'), /escapes the store/);
});
