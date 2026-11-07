import test from 'node:test';
import assert from 'node:assert/strict';
import { RepetitionGuard } from '../extension/lib/repetition-guard.js';

const passage = 'Сегодня мы подробно рассмотрим устройство нового приложения затем откроем настройки проверим подключение выберем нужный язык запустим видео сохраним готовый результат и перейдём к следующему разделу нашего большого урока ';

test('detects a repeated long passage across arbitrary token and sentence boundaries', () => {
  const guard = new RepetitionGuard();
  assert.equal(guard.push(passage), false);
  guard.finish();
  assert.equal(guard.push(passage.toUpperCase()), false);
  let detected = false;
  for (let i = 0; i < passage.length; i += 7) detected ||= guard.push(passage.slice(i, i + 7));
  assert.equal(detected, true);
  guard.reset();
  assert.equal(guard.push(passage), false);
});

test('normal short repeats and varied long speech are not a loop', () => {
  const guard = new RepetitionGuard();
  assert.equal(guard.push('да да да нет нет нет '.repeat(1000)), false);
  guard.reset();
  for (let i = 0; i < 100; i++) assert.equal(guard.push(`${passage} отдельная${i} глава${i} `), false);
  assert.ok(guard.text.length <= 24000);
  assert.ok(guard.phrase.length <= 24000);
});

test('a final full transcription is an update rather than repeated speech', () => {
  const guard = new RepetitionGuard();
  assert.equal(guard.push(passage), false);
  assert.equal(guard.push(passage, true), false);
  assert.equal(guard.push(passage), false);
  assert.equal(guard.push(passage, true), false);
  assert.equal(guard.text, passage.repeat(2));
});

test('final phrases without trailing whitespace still keep separate word boundaries', () => {
  const guard = new RepetitionGuard();
  for (let i = 0; i < 3; i++) assert.equal(guard.push(passage.trim(), true), i === 2);
  guard.reset();
  for (let i = 0; i < 3; i++) {
    assert.equal(guard.push(passage.trim()), i === 2);
    guard.finish();
  }
});
