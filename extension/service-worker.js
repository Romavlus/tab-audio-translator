import { browserLanguage } from './lib/languages.js';
import { DEFAULTS, normalizeSettings, publicSettings, friendlyError } from './lib/settings.js';
import { cleanupArchive, recoverSessions, listSessions } from './lib/archive.js';
import { safeSource } from './lib/transcript.js';
import { translationSetup, GeminiWire } from './lib/gemini-wire.js';

const engineUrl = chrome.runtime.getURL('offscreen.html');
const trustedPages = new Set(['popup.html', 'options.html'].map(path => chrome.runtime.getURL(path)));
let creating;
let mutations = Promise.resolve();
async function hasEngine() {
  return (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [engineUrl] })).length > 0;
}
async function ensureEngine() {
  if (await hasEngine()) return;
  if (!creating) creating = chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'], justification: 'Capture tab audio and play translated speech independently of the popup.' }).finally(() => { creating = null; });
  await creating;
}
async function engine(type, extra = {}) {
  const response = await chrome.runtime.sendMessage({ target: 'engine', type, ...extra });
  if (!response?.ok) throw new Error(response?.error || 'The audio engine is not responding. Reopen the extension and try again.');
  return response.data;
}
async function settings() {
  const config = normalizeSettings((await chrome.storage.local.get('settings')).settings || DEFAULTS);
  if (config.languageMode === 'auto') config.targetLanguage = await browserLanguage();
  return config;
}
async function state() {
  if (await hasEngine()) return engine('snapshot');
  const last = (await listSessions())[0];
  return { running: false, status: 'idle', sessionId: last?.id || null, latest: '', detail: '', storageError: '' };
}
async function saveSettings(patch) {
  const current = await settings();
  const mode = patch.targetLanguage && !patch.languageMode ? 'manual' : (patch.languageMode || current.languageMode);
  const next = normalizeSettings({ ...current, ...patch, languageMode: mode });
  if (next.languageMode === 'auto') next.targetLanguage = await browserLanguage();
  await chrome.storage.local.set({ settings: next });
  if (await hasEngine()) await engine('patch', { settings: next });
  return publicSettings(next);
}
async function inject(tabId) {
  try { await chrome.scripting.executeScript({ target: { tabId }, files: ['content/page.js'] }); return true; }
  catch { return false; }
}
async function pageMessage(tabId, message) {
  try { await chrome.tabs.sendMessage(tabId, { target: 'translator-page', ...message }); } catch { /* Page may be restricted or navigating. */ }
}
async function start(tabId) {
  if ((await state()).running) throw new Error('Stop the current tab translation first.');
  const config = await settings();
  if (!config.apiKey) throw new Error('Add a Gemini API key in Settings.');
  const tab = await chrome.tabs.get(tabId);
  if (!/^(https?:|file:)/.test(tab.url || '')) throw new Error('Open a regular web page with audio and start the extension there.');
  await ensureEngine();
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  const source = safeSource(tab);
  const session = { id: crypto.randomUUID(), startedAt: Date.now(), updatedAt: Date.now(), endedAt: null, status: 'active', ...source, sources: [{ ...source, at: Date.now() }] };
  const result = await engine('start', { streamId, session, tabId, settings: config });
  await inject(tabId);
  await pageMessage(tabId, { type: 'captions', sessionId: session.id, enabled: config.captions, text: '' });
  return result;
}
async function checkKey() {
  const config = await settings();
  if (!config.apiKey) throw new Error('Enter and save your API key first.');
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}`, {
      headers: { 'x-goog-api-key': config.apiKey }, signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error?.status || `Gemini: ${response.status}`);
    }
    const live = new GeminiWire({ apiKey: config.apiKey, setup: translationSetup(config) });
    try { await live.open(); } finally { live.close(); }
    return 'Key accepted. The translation model is available.';
  } catch (error) { throw new Error(friendlyError(error, config.apiKey)); }
}
async function handle(message) {
  switch (message.type) {
    case 'snapshot': return { state: await state(), settings: { ...publicSettings(await settings()), detectedLanguage: await browserLanguage() } };
    case 'start': return start(message.tabId);
    case 'stop': return (await hasEngine()) ? engine('stop') : state();
    case 'save-settings': return saveSettings(message.patch);
    case 'get-settings': return settings();
    case 'check-key': return checkKey();
    case 'flush': return (await hasEngine()) ? engine('flush') : state();
    default: throw new Error('Unknown extension command.');
  }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.target !== 'worker' || sender.id !== chrome.runtime.id) return;
  if (sender.url === engineUrl) {
    if (message.type === 'engine-state') {
      const { running, status } = message.state;
      void chrome.action.setBadgeText({ text: running ? (status === 'paused' ? 'Ⅱ' : '▶') : '' });
      void chrome.action.setBadgeBackgroundColor({ color: status === 'connected' ? '#5e76c4' : '#a86c2d' });
    }
    if (message.type === 'engine-caption') void pageMessage(message.tabId, {
      type: 'captions', sessionId: message.sessionId, enabled: message.enabled, text: message.text,
    });
    respond({ ok: true }); return;
  }
  if (!trustedPages.has(sender.url)) {
    if (message.type === 'media' && sender.tab) {
      void state().then(current => {
        if (current.running && current.tabId === sender.tab.id) return engine('media', { action: message.action });
      }).catch(() => {});
    }
    return;
  }
  const action = () => handle(message);
  // Serialise mutations across popup instances; reads remain responsive.
  const task = ['start', 'stop', 'save-settings'].includes(message.type) ? mutations.then(action) : action();
  if (['start', 'stop', 'save-settings'].includes(message.type)) mutations = task.catch(() => {});
  task.then(data => respond({ ok: true, data }), error => respond({ ok: false, error: friendlyError(error) }));
  return true;
});
chrome.tabs.onRemoved.addListener(tabId => { void state().then(current => {
  if (current.running && current.tabId === tabId) return engine('stop');
}).catch(() => {}); });
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (!change.url && change.status !== 'complete') return;
  void (async () => {
    const current = await state(); if (!current.running || current.tabId !== tabId) return;
    if (change.url) await engine('source', { source: safeSource(tab) });
    if (change.status === 'complete') {
      await inject(tabId);
      await pageMessage(tabId, { type: 'captions', enabled: (await settings()).captions, sessionId: current.sessionId, text: current.latest || '' });
    }
  })().catch(() => {});
});
async function housekeeping() {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  if (!(await chrome.storage.local.get('settings')).settings) await chrome.storage.local.set({ settings: { ...DEFAULTS, targetLanguage: await browserLanguage() } });
  await cleanupArchive();
  const active = (await hasEngine()) ? await engine('snapshot') : null;
  await recoverSessions(active?.running ? active.sessionId : null);
  if (!active?.running) await chrome.action.setBadgeText({ text: '' });
  await chrome.alarms.create('archive-cleanup', { periodInMinutes: 30 });
}
chrome.runtime.onInstalled.addListener(() => { void housekeeping().catch(() => {}); });
chrome.runtime.onStartup.addListener(() => { void housekeeping().catch(() => {}); });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'archive-cleanup') void cleanupArchive().catch(() => {}); });
