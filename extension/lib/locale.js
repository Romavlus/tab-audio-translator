import { CATALOGS } from './locales.js';
import { populateLanguages, languageLabel } from './languages.js';
let current = 'en';
export function interfaceLocale(language = 'en') {
  if (language === 'zh-Hant') return 'en';
  const base = language.split('-')[0];
  return Object.hasOwn(CATALOGS, base) ? base : 'en';
}
export function text(key) { return CATALOGS[current][key] ?? CATALOGS.en[key] ?? key; }
export function currentLocale() { return current; }
export function applyLocale(language, config) {
  current = interfaceLocale(language);
  document.documentElement.lang = current;
  document.documentElement.dir = 'ltr';
  document.title = text('title');
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = text(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = text(el.dataset.i18nPlaceholder);
  for (const el of document.querySelectorAll('[data-i18n-label]')) el.setAttribute('aria-label', text(el.dataset.i18nLabel));
  const select = document.getElementById('target-language');
  if (select) {
    
    populateLanguages(select, current, config.languageMode === 'auto' ? 'auto' : config.targetLanguage,
      `${text('auto')} (${languageLabel(config.detectedLanguage || config.targetLanguage, current)})`);
  }
  const fallback = document.getElementById('locale-fallback');
  if (fallback) fallback.hidden = current !== 'en' || language.split('-')[0] === 'en';
  const reveal = document.getElementById('reveal-key');
  if (reveal) {
    const label = text(document.getElementById('api-key').type === 'password' ? 'show' : 'hide');
    reveal.textContent = label; reveal.setAttribute('aria-label', label);
  }
}
