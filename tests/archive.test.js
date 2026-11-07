import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, updateSession, saveFragments, getSession, getFragments, listSessions, cleanupArchive, deleteSession, clearArchive, recoverSessions } from '../extension/lib/archive.js';
import { WEEK_MS, selectFragments, plainText } from '../extension/lib/transcript.js';
const now = 1_800_000_000_000;
const session = (id, startedAt = now) => ({ id, startedAt, title: 'Example', url: 'https://example.com/video', endedAt: null });
const row = (id, sessionId, createdAt, kind = 'output', text = id) => ({ id, sessionId, kind, text, createdAt, updatedAt: createdAt, offsetMs: 0 });
test.beforeEach(clearArchive);
test('original and translation are upserted independently without duplicate partial phrases', async () => {
  await createSession(session('s'));
  await saveFragments([row('i', 's', now, 'input', 'Hello'), row('o', 's', now, 'output', 'При')], now);
  await saveFragments([row('o', 's', now, 'output', 'Привет')], now);
  const rows = await getFragments('s', now);
  assert.equal(rows.length, 2);
  assert.equal(plainText(selectFragments(rows, { now, end: now })), 'Привет');
  assert.equal(plainText(selectFragments(rows, { now, end: now, kind: 'input' })), 'Hello');
});
test('cleanup expires individual fragments and removes empty old session metadata', async () => {
  const old = now - WEEK_MS - 1;
  await createSession(session('expired', old)); await createSession(session('crosses', old));
  await saveFragments([row('gone', 'expired', old), row('older', 'crosses', old)], old);
  await saveFragments([row('boundary', 'crosses', now - WEEK_MS)], now);
  await cleanupArchive(now);
  assert.equal(await getSession('expired'), undefined);
  assert.deepEqual((await getFragments('crosses', now)).map(r => r.id), ['boundary']);
  assert.deepEqual((await listSessions(now)).map(s => s.id), ['crosses']);
});
test('reads and copy filter expired text even before physical cleanup runs', async () => {
  const old = now - WEEK_MS - 1;
  await createSession(session('s', old)); await saveFragments([row('old', 's', old)], old);
  assert.deepEqual(await getFragments('s', now), []);
  assert.deepEqual(await listSessions(now), []);
  assert.equal(plainText(selectFragments([row('old', 's', old)], { now, end: now })), '');
});
test('deleting one session preserves others and late writes cannot resurrect deleted text', async () => {
  await createSession(session('a')); await createSession(session('b'));
  await saveFragments([row('a1', 'a', now), row('b1', 'b', now)], now);
  await deleteSession('a'); await saveFragments([row('a2', 'a', now)], now);
  assert.deepEqual(await getFragments('a', now), []);
  assert.equal((await getFragments('b', now)).length, 1);
});
test('startup recovery finalizes interrupted sessions but preserves an active offscreen session', async () => {
  await createSession(session('interrupted')); await createSession(session('active'));
  await updateSession('interrupted', { updatedAt: now + 500 });
  await recoverSessions('active', now + 1000);
  assert.equal((await getSession('interrupted')).endedAt, now + 500);
  assert.equal((await getSession('interrupted')).status, 'interrupted');
  assert.equal((await getSession('active')).endedAt, null);
});
test('copying N minutes respects the selected session end and exact boundary', () => {
  const rows = [row('old', 's', now - 60001), row('edge', 's', now - 60000), row('last', 's', now)];
  assert.equal(plainText(selectFragments(rows, { now, end: now, minutes: 1 })), 'edge\n\nlast');
  assert.equal(selectFragments(rows, { now: now + 3600000, end: now, minutes: 10 }).length, 3);
  for (const minutes of [0, -1, Infinity, NaN]) assert.throws(() => selectFragments(rows, { minutes }), /greater than zero/);
});
