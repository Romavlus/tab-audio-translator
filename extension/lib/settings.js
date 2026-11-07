import { matchLanguage } from './languages.js';
export const DEFAULTS = Object.freeze({
  languageMode: 'auto', mode: 'voice', voiceVolume: 80, apiKey: '', model: 'gemini-3.5-live-translate-preview', targetLanguage: 'en',
  originalVolume: 15, translationVolume: 80, captions: false,
});
export function normalizeSettings(value = {}) {
  const percent = (v, fallback) => typeof v === 'number' && Number.isFinite(v)
    ? Math.round(Math.max(0, Math.min(100, v))) : fallback;
  const model = typeof value.model === 'string' ? value.model.trim().replace(/^models\//, '') : DEFAULTS.model;
  const language = typeof value.targetLanguage === 'string' ? value.targetLanguage : DEFAULTS.targetLanguage;
  return {
    mode: ['voice', 'subtitles', 'both'].includes(value.mode) ? value.mode : 'voice',
    voiceVolume: percent(value.voiceVolume, 80),
    apiKey: typeof value.apiKey === 'string' ? value.apiKey.trim() : '',
    model: /^[a-zA-Z0-9._-]{1,120}$/.test(model) ? model : DEFAULTS.model,
    targetLanguage: matchLanguage(language) || DEFAULTS.targetLanguage,
    languageMode: value.languageMode === 'auto' ? 'auto' : 'manual',
    originalVolume: percent(value.originalVolume, 15),
    translationVolume: percent(value.translationVolume, 80),
    captions: value.captions === true,
  };
}
export function publicSettings(value) {
  const { apiKey, ...rest } = normalizeSettings(value);
  return { ...rest, hasKey: Boolean(apiKey) };
}
export function friendlyError(error, key = '') {
  const message = String(error?.message || error || 'Unknown error');
  if (/quota|RESOURCE_EXHAUSTED|429/i.test(message)) return 'Gemini quota exceeded. Check your quotas in Google AI Studio.';
  if (/API_KEY|UNAUTHENTICATED|401/i.test(message)) return 'Gemini rejected the API key. Check the key in Settings.';
  if (/PERMISSION_DENIED|403/i.test(message)) return 'Gemini access denied. Check key restrictions and API access for your project.';
  // Never show a key, even if a platform error happens to include its URL.
  return (key ? message.split(key).join('[key hidden]') : message)
    .replace(/([?&]key=)[^\s&]+/gi, '$1[hidden]').slice(0, 600);
}
