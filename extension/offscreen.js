import { TranslationConnection } from './lib/translation-connection.js';
import { translationSetup } from './lib/gemini-wire.js';
import { Transcript, WEEK_MS } from './lib/transcript.js';
import { createSession, saveFragments, updateSession } from './lib/archive.js';
import { friendlyError } from './lib/settings.js';

let run = null;
let lastState = { running: false, status: 'idle', sessionId: null, latest: '', detail: '', storageError: '' };
const pending = new Map();
let flushTimer;
let flushing;
let stopping;
const send = message => chrome.runtime.sendMessage({ target: 'worker', ...message }).catch(() => {});
function snapshot() {
  if (!run) return { ...lastState };
  const { id, tabId, startedAt, running, status, detail, latest, latestInput, storageError, source, notice } = run;
  return {
    sessionId: id, tabId, startedAt, running, status, detail,
    latest: run.latestAt >= Date.now() - WEEK_MS ? latest : '',
    latestInput: run.latestInputAt >= Date.now() - WEEK_MS ? latestInput : '',
    storageError, source, notice,
  };
}
function announce() { lastState = snapshot(); void send({ type: 'engine-state', state: lastState }); }
function captions(text = run?.latest || '', enabled = run?.settings.captions) {
  if (!run) return;
  enabled = Boolean(enabled && run.running);
  const previous = run.captionState;
  // Disabled captions need no per-token messages or worker/page wakeups.
  if (!enabled && !previous?.enabled) return;
  if (previous?.enabled === enabled && previous.text === text) return;
  run.captionState = { enabled, text };
  void send({ type: 'engine-caption', tabId: run.tabId, sessionId: run.id, text, enabled });
}
function queueRow(row, owner) {
  pending.set(row.id, row);
  if (row.kind === 'output') {
    owner.latest = row.text;
    owner.latestAt = row.createdAt;
    if (run === owner) captions();
  } else if (row.kind === 'input') {
    owner.latestInput = row.text;
    owner.latestInputAt = row.createdAt;
  }
  scheduleFlush();
}
// At most one archive write per two seconds during a continuous transcript. A
// one-shot timer also saves a final short phrase; no polling when idle.
function scheduleFlush(delay = 2000) {
  if (!flushTimer && pending.size) flushTimer = setTimeout(() => { flushTimer = null; void flush(); }, delay);
}
async function flush() {
  if (flushing) { await flushing; return; }
  clearTimeout(flushTimer); flushTimer = null;
  if (!pending.size) return;
  const rows = [...pending.values()];
  for (const row of rows) pending.delete(row.id);
  flushing = (async () => {
    try {
      await saveFragments(rows);
      if (run?.storageError) { run.storageError = ''; announce(); }
    } catch {
      for (const row of rows) if (!pending.has(row.id)) pending.set(row.id, row);
      if (run) { run.storageError = 'Could not save history. Free up archive or disk space. Current text remains in memory for now.'; announce(); }
    }
  })();
  await flushing; flushing = null;
  scheduleFlush();
}
async function flushLatest() {
  await flush();
  if (pending.size && !run?.storageError) await flush();
}
function startLoop(owner) {
  if (!owner.running || run !== owner) return;
  const generation = owner.generation;
  owner.loop = new TranslationConnection({
    apiKey: owner.settings.apiKey, setup: translationSetup(owner.settings),
    onStatus(status, detail = '') {
      if (run !== owner || !owner.running || generation !== owner.generation) return;
      owner.status = status; owner.detail = friendlyError(detail, owner.settings.apiKey);
      if (!detail) owner.detail = '';
      announce();
      if (status === 'failed') void stop('failed', owner.detail);
    },
    onEvent(event) {
      if (run !== owner || !owner.running || generation !== owner.generation) return;
      if (event.type === 'reset') {
        owner.player.port.postMessage({ command: 'clear' });
        owner.transcript.finishAll();
        owner.latest = owner.latestInput = ''; captions('', false);
        owner.notice = event.reason === 'backlog'
          ? 'Translated speech is over 30 seconds behind. Reconnecting to the current audio.'
          : 'A long translation loop was detected. Reconnecting to the current audio.';
        announce();
      } else if (event.type === 'clearAudio') {
        owner.player.port.postMessage({ command: 'clear' });
        owner.transcript.finishAll();
      } else if (event.type === 'audio') {
        owner.player.port.postMessage(event.buffer, [event.buffer]);
      } else if (event.type === 'input' || event.type === 'output') {
        owner.transcript.push(event.type, event.text, event.finished);
      } else if (event.type === 'turnComplete') owner.transcript.finishAll();
    },
  });
  owner.loop.start();
}
async function start({ streamId, session, tabId, settings }) {
  if (stopping) await stopping;
  if (run?.running) throw new Error('Translation is already running. Stop the current session first.');
  await flush();
  const owner = run = {
    id: session.id, tabId, startedAt: session.startedAt, source: { title: session.title, url: session.url },
    settings, running: true, status: 'connecting', detail: '', storageError: '', latest: '', latestInput: '', notice: '',
    contexts: [], generation: 0, loop: null, stream: null,
  };
  owner.transcript = new Transcript({ sessionId: owner.id, startedAt: owner.startedAt, emit: row => queueRow(row, owner) });
  announce();
  try {
    await createSession(session);
    owner.stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } }, video: false,
    });
    const pass = new AudioContext(); owner.contexts.push(pass);
    owner.originalGain = pass.createGain(); owner.originalGain.gain.value = settings.originalVolume / 100;
    pass.createMediaStreamSource(owner.stream).connect(owner.originalGain).connect(pass.destination);
    const up = new AudioContext({ sampleRate: 16000 }); owner.contexts.push(up);
    const down = new AudioContext({ sampleRate: 24000 }); owner.contexts.push(down);
    await Promise.all([
      up.audioWorklet.addModule('audio/tab-pcm-input.js'),
      down.audioWorklet.addModule('audio/tab-pcm-output.js'),
    ]);
    owner.player = new AudioWorkletNode(down, 'tab-pcm-output');
    owner.translationGain = down.createGain(); owner.translationGain.gain.value = settings.translationVolume / 100;
    owner.player.connect(owner.translationGain).connect(down.destination);
    owner.player.port.onmessage = ({ data }) => {
      if (run === owner && owner.running && data.type === 'overflow') owner.loop?.recover('backlog');
    };
    owner.recorder = new AudioWorkletNode(up, 'tab-pcm-input', {
      channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers',
    });
    owner.recorder.port.onmessage = ({ data }) => {
      if (!owner.running) return;
      owner.loop?.send(data);
    };
    up.createMediaStreamSource(owner.stream).connect(owner.recorder);
    // Keep the recording graph pulled without making the original audible twice.
    const silent = up.createGain(); silent.gain.value = 0;
    owner.recorder.connect(silent).connect(up.destination);
    await Promise.all(owner.contexts.map(context => context.resume()));
    for (const track of owner.stream.getTracks()) track.onended = () => { if (owner.running) void stop('stopped', 'Tab audio capture ended.'); };
    startLoop(owner);
    return snapshot();
  } catch (error) {
    await stop('failed', friendlyError(error, settings.apiKey));
    throw new Error(friendlyError(error, settings.apiKey));
  }
}
async function release(status, detail) {
  const owner = run;
  if (!owner?.running) return snapshot();
  owner.running = false; owner.generation++;
  owner.loop?.close(); owner.loop = null;
  owner.transcript.finishAll();
  owner.recorder && (owner.recorder.port.onmessage = null);
  owner.player?.port.postMessage({ command: 'clear' });
  for (const track of owner.stream?.getTracks() || []) { track.onended = null; track.stop(); }
  await Promise.allSettled(owner.contexts.map(context => context.close()));
  await flushLatest();
  try { await updateSession(owner.id, { endedAt: Date.now(), status, detail }); }
  catch { owner.storageError = 'Could not update history. Free up disk space.'; }
  // Release closed contexts, ports and their worklet buffers even though the
  // lightweight last-run state remains available for the popup.
  for (const node of [owner.recorder, owner.player]) {
    if (node) { node.port.onmessage = null; node.disconnect(); node.port.close(); }
  }
  owner.contexts = [];
  owner.stream = owner.recorder = owner.player = null;
  owner.originalGain = owner.translationGain = owner.transcript = null;
  owner.settings.apiKey = '';
  owner.status = status; owner.detail = detail;
  if (run === owner) { captions('', false); announce(); }
  return snapshot();
}
function stop(status = 'stopped', detail = '') {
  if (!stopping) stopping = release(status, detail).finally(() => { stopping = null; });
  return stopping;
}
function patch(settings) {
  if (run?.running) {
    for (const key of ['originalVolume', 'translationVolume', 'captions']) run.settings[key] = settings[key];
    if (run.originalGain) run.originalGain.gain.setTargetAtTime(settings.originalVolume / 100, run.contexts[0].currentTime, 0.03);
    if (run.translationGain) run.translationGain.gain.setTargetAtTime(settings.translationVolume / 100, run.contexts[2].currentTime, 0.03);
    captions();
  }
  return snapshot();
}
function mediaEvent(action) {
  if (!run?.running || !run.player) return;
  const owner = run;
  if (action === 'pause' || action === 'seeking') {
    owner.generation++; owner.loop?.close(); owner.loop = null;
    owner.player.port.postMessage({ command: 'clear' }); owner.transcript.finishAll();
    owner.status = 'paused'; owner.detail = ''; captions('', false); announce();
  } else if (action === 'play' && !owner.loop) startLoop(owner);
}
async function changeSource(source) {
  if (!run?.running) return;
  const owner = run;
  owner.source = source;
  const { getSession } = await import('./lib/archive.js');
  const session = await getSession(owner.id);
  if (session && session.sources?.at(-1)?.url !== source.url) {
    await updateSession(owner.id, { sources: [...(session.sources || []), { ...source, at: Date.now() }] });
  }
  if (run === owner) announce();
}
let commands = Promise.resolve();
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.target !== 'engine' || sender.id !== chrome.runtime.id || sender.tab) return;
  const execute = async () => {
    switch (message.type) {
      case 'snapshot': return snapshot();
      case 'start': return start(message);
      case 'stop': return stop();
      case 'patch': return patch(message.settings);
      case 'media': return mediaEvent(message.action);
      case 'source': return changeSource(message.source);
      case 'flush': await flushLatest(); return snapshot();
      default: throw new Error('Unknown audio engine command.');
    }
  };
  const task = commands.then(execute);
  commands = task.catch(() => {});
  task.then(data => respond({ ok: true, data }), error => respond({ ok: false, error: friendlyError(error, run?.settings.apiKey) }));
  return true;
});
// The service worker owns the archive-cleanup alarm; no duplicate idle timers.
