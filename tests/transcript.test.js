import test from 'node:test';
import assert from 'node:assert/strict';
import { Transcript, safeSource } from '../extension/lib/transcript.js';
import { normalizeSettings, publicSettings, friendlyError } from '../extension/lib/settings.js';
import { translationSetup } from '../extension/lib/gemini-wire.js';
test('input and output deltas use separate phrases and finished snapshots replace partial text', () => {
  let now = 1000; const rows = [];
  const stream = new Transcript({ sessionId: 's', startedAt: now, now: () => now, emit: row => rows.push(row) });
  stream.push('input', 'Hello'); stream.push('output', 'При'); stream.push('output', 'вет');
  stream.push('output', 'Привет!', true); stream.finishAll();
  const outputs = rows.filter(r => r.kind === 'output');
  assert.equal(new Set(outputs.map(r => r.id)).size, 1);
  assert.equal(outputs.at(-1).text, 'Привет!'); assert.equal(outputs.at(-1).finalized, true);
  assert.notEqual(outputs[0].id, rows[0].id);
});
test('continuous speech is split into bounded phrases without dropping its text', () => {
  let now = 1000; const emitted = [];
  const stream = new Transcript({ sessionId: 's', startedAt: now, now: () => now, emit: row => emitted.push(row) });
  stream.push('output', 'Первая.'); now += 12001; stream.push('output', 'Вторая.'); stream.finishAll();
  assert.deepEqual(emitted.filter(r => r.finalized).map(r => r.text), ['Первая.', 'Вторая.']);
});
test('silence finalizes an open phrase and empty finished event closes it', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); const emitted = [];
  const stream = new Transcript({ sessionId: 's', startedAt: 0, emit: row => emitted.push(row) });
  stream.push('input', 'A'); t.mock.timers.tick(1401);
  assert.equal(emitted.at(-1).finalized, true);
  stream.push('output', 'Б'); stream.push('output', '', true);
  assert.equal(emitted.at(-1).finalized, true);
});
test('settings are bounded, restricted and public settings never include a key', () => {
  const settings = normalizeSettings({ apiKey: ' secret ', originalVolume: -3, translationVolume: 110, model: '../bad', targetLanguage: 'bad', captions: 'true' });
  assert.equal(settings.apiKey, 'secret'); assert.equal(settings.originalVolume, 0); assert.equal(settings.translationVolume, 100);
  assert.equal(settings.targetLanguage, 'en'); assert.equal(settings.captions, false);
  assert.ok(!('apiKey' in publicSettings(settings))); assert.equal(publicSettings(settings).hasKey, true);
});
test('setup requests original and translated transcripts with translation-only configuration', () => {
  const { setup } = translationSetup(normalizeSettings());
  assert.deepEqual(setup.inputAudioTranscription, {}); assert.deepEqual(setup.outputAudioTranscription, {});
  assert.equal(setup.generationConfig.inputAudioTranscription, undefined);
  assert.deepEqual(setup.generationConfig.translationConfig, { targetLanguageCode: 'en', echoTargetLanguage: false });
  assert.equal(setup.systemInstruction, undefined);
});
test('source URLs and errors cannot expose credentials', () => {
  assert.equal(safeSource({ url: 'https://user:password@example.com/watch?v=1#foo' }).url, 'https://example.com/watch?v=1');
  assert.equal(safeSource({ url: 'javascript:alert(1)' }).url, '');
  assert.ok(!friendlyError(new Error('socket?key=secret'), 'secret').includes('secret'));
  assert.match(friendlyError(new Error('RESOURCE_EXHAUSTED')), /quota/);
});
