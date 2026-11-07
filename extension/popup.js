import { localizeRuntimeMessage } from './lib/runtime-messages.js';
import { languageItems } from './lib/languages.js';
import { applyLocale, currentLocale, text as t } from './lib/locale.js';
import { $, rpc, notify } from './lib/ui.js';
let state = {}, config = {}, tab, busy = false, loading = false, pending = 0, queue = Promise.resolve();
let settingsOpen = false, languagesOpen = false, keyLoaded = false, localeSignature = '';
function localize() {
  const signature = `${config.targetLanguage}:${config.languageMode}:${config.detectedLanguage}`;
  if (signature !== localeSignature) { localeSignature = signature; applyLocale(config.targetLanguage, config); if (languagesOpen) renderLanguages(); }
}
const usableTab = () => tab?.id && /^(https?:|file:)/.test(tab.url || '');
function drawMode() {
  for (const button of document.querySelectorAll('[data-mode]')) button.setAttribute('aria-pressed', String(button.dataset.mode === config.mode));
  $('voice-controls').hidden = config.mode === 'subtitles';
}
async function refresh(initial = false) {
  if (loading) return; loading = true;
  try {
    const data = await rpc('snapshot'); state = data.state;
    if (!pending) config = data.settings;
    localize();
    if (initial) { $('translation').value = config.voiceVolume; $('original').value = config.originalVolume; }
    if (document.activeElement !== $('target-language')) $('target-language').value = config.languageMode === 'auto' ? 'auto' : config.targetLanguage;
    $('original-value').value = `${$('original').value}%`; $('translation-value').value = `${$('translation').value}%`;
    $('key-hint').hidden = config.hasKey; $('tab-hint').hidden = Boolean(usableTab()) || state.running;
    $('source').textContent = state.running ? (state.source?.title || t('chooseTab')) : (usableTab() ? tab.title : t('chooseTab'));
    $('status').textContent = state.running ? (state.status === 'connected' && !state.latest && !state.latestInput ? t('waiting') : ({connecting:t('connecting'),disconnected:t('reconnecting'),error:t('reconnecting'),paused:t('paused'),connected:t('translation')})[state.status] || t('waiting')) : (state.status === 'failed' ? t('failed') : config.hasKey ? t('ready') : t('needsKey'));
    $('dot').className = `dot ${state.running ? (state.status === 'connected' ? 'active' : 'pending') : ''}`;
    $('detail').textContent = localizeRuntimeMessage(state.detail || '', currentLocale()); $('detail').hidden = !state.detail;
    $('toggle').textContent = state.running ? t('stop') : config.hasKey ? t('start') : t('connect');
    $('toggle').classList.toggle('stop', Boolean(state.running));
    $('toggle').disabled = busy || Boolean(pending) || (!state.running && config.hasKey && !usableTab());
    $('target-language').disabled = busy || Boolean(pending) || state.running;
    $('all-languages').disabled = busy || Boolean(pending) || state.running;
    $('latest-card').hidden = !state.running || !(state.latest || state.latestInput);
    $('latest-translation').textContent = state.latest || t('waiting'); $('latest').textContent = state.latestInput || t('waiting');
    const warning = state.storageError || state.notice || ''; $('warning').textContent = localizeRuntimeMessage(warning, currentLocale()); $('warning').hidden = !warning;
    drawMode();
  } catch (error) { notify(error.message, true); } finally { loading = false; }
}
async function panel(show) {
  if (languagesOpen) showLanguages(false);
  settingsOpen = show; $('translate-panel').hidden = show; $('settings-panel').hidden = !show; $('settings').hidden = show;
  if (show && !keyLoaded) {
    try { const data = await rpc('get-settings'); $('api-key').value = data.apiKey; keyLoaded = true; } catch (error) { notify(error.message, true); }
  }
  (show ? $('back') : $('toggle')).focus();
}
function change(patch) {
  pending++; Object.assign(config, patch); drawMode();
  queue = queue.then(() => rpc('save-settings', { patch })).catch(error => notify(error.message, true)).finally(async () => { pending--; await refresh(); });
  return queue;
}
function renderLanguages() {
  const locale = currentLocale();
  const query = $('language-search').value.trim().toLocaleLowerCase(locale);
  const items = languageItems(locale).filter(item => `${item.label} ${item.native} ${item.name} ${item.code}`.toLocaleLowerCase(locale).includes(query));
  $('language-list').replaceChildren();
  $('no-languages').hidden = items.length > 0;
  for (const item of items) {
    const button = document.createElement('button'); button.type = 'button';
    button.textContent = item.label; button.dataset.language = item.code;
    button.setAttribute('aria-pressed', String(config.targetLanguage === item.code));
    button.addEventListener('click', async () => {
      if (busy || pending || state.running) return;
      await change({ targetLanguage: item.code, languageMode: 'manual' });
      showLanguages(false);
    });
    $('language-list').append(button);
  }
}
function showLanguages(show) {
  languagesOpen = show;
  $('languages-panel').hidden = !show; $('translate-panel').hidden = show;
  $('settings').hidden = show;
  if (show) { $('language-search').value = ''; renderLanguages(); $('language-search').focus(); }
  else $('all-languages').focus();
}
$('all-languages').addEventListener('click', () => showLanguages(true));
$('languages-back').addEventListener('click', () => showLanguages(false));
$('language-search').addEventListener('input', renderLanguages);
$('settings').addEventListener('click', () => void panel(true)); $('add-key').addEventListener('click', () => void panel(true)); $('back').addEventListener('click', () => void panel(false));
$('archive').addEventListener('click', () => chrome.runtime.openOptionsPage());
document.addEventListener('keydown', event => { if (event.key === 'Escape' && (settingsOpen || languagesOpen)) { event.preventDefault(); if (languagesOpen) showLanguages(false); else void panel(false); } });
$('toggle').addEventListener('click', async () => {
  if (busy || pending) return;
  if (!config.hasKey && !state.running) { await panel(true); return; }
  busy = true; $('toggle').disabled = true; notify();
  try { await queue; await rpc(state.running ? 'stop' : 'start', { tabId: tab?.id }); } catch (error) { notify(error.message, true); } finally { busy = false; await refresh(); }
});
for (const button of document.querySelectorAll('[data-mode]')) button.addEventListener('click', () => {
  const mode = button.dataset.mode;
  void change({ mode, captions: mode !== 'voice', translationVolume: mode === 'subtitles' ? 0 : Number($('translation').value) });
});
$('target-language').addEventListener('change', () => void change($('target-language').value === 'auto' ? { languageMode: 'auto' } : { targetLanguage: $('target-language').value, languageMode: 'manual' }));
for (const id of ['translation', 'original']) {
  $(id).addEventListener('input', () => { $(`${id}-value`).value = `${$(id).value}%`; });
  $(id).addEventListener('change', () => void change(id === 'original' ? { originalVolume: Number($(id).value) } : { voiceVolume: Number($(id).value), translationVolume: config.mode === 'subtitles' ? 0 : Number($(id).value) }));
}
$('reveal-key').addEventListener('click', () => {
  const show = $('api-key').type === 'password'; $('api-key').type = show ? 'text' : 'password'; $('reveal-key').textContent = show ? t('hide') : t('show'); $('reveal-key').setAttribute('aria-label', show ? t('hide') : t('show'));
});
async function saveKey() {
  await queue; const key = $('api-key').value.trim(); if (!key) throw new Error(t('emptyKey'));
  config = await rpc('save-settings', { patch: { apiKey: key } });
}
$('settings-form').addEventListener('submit', async event => {
  event.preventDefault();
  try { await saveKey(); notify(t('saved'), false, $('settings-message')); await refresh(); } catch (error) { notify(error.message, true, $('settings-message')); }
});
$('check-key').addEventListener('click', async () => {
  $('check-key').disabled = true; notify(t('checking'), false, $('settings-message'));
  try { await saveKey(); await rpc('check-key'); notify(t('ready'), false, $('settings-message')); await refresh(); } catch (error) { notify(error.message, true, $('settings-message')); } finally { $('check-key').disabled = false; }
});
try { [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); } catch { /* Empty-state guidance remains visible. */ }
await refresh(true); setInterval(() => void refresh(), 1000);
