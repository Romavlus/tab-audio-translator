// Language codes verified against Google's Live Translation guide, 2026-11-07.
export const LANGUAGES = [{"code": "af", "name": "Afrikaans"}, {"code": "ak", "name": "Akan"}, {"code": "am", "name": "Amharic"}, {"code": "ar", "name": "Arabic"}, {"code": "az", "name": "Azerbaijani"}, {"code": "be", "name": "Belarusian"}, {"code": "bg", "name": "Bulgarian"}, {"code": "bn", "name": "Bengali"}, {"code": "ca", "name": "Catalan"}, {"code": "cs", "name": "Czech"}, {"code": "da", "name": "Danish"}, {"code": "de", "name": "German"}, {"code": "el", "name": "Greek"}, {"code": "en", "name": "English"}, {"code": "es", "name": "Spanish"}, {"code": "et", "name": "Estonian"}, {"code": "eu", "name": "Basque"}, {"code": "fa", "name": "Persian"}, {"code": "fi", "name": "Finnish"}, {"code": "fil", "name": "Filipino"}, {"code": "fr", "name": "French"}, {"code": "gl", "name": "Galician"}, {"code": "gu", "name": "Gujarati"}, {"code": "ha", "name": "Hausa"}, {"code": "he", "name": "Hebrew"}, {"code": "hi", "name": "Hindi"}, {"code": "hr", "name": "Croatian"}, {"code": "hu", "name": "Hungarian"}, {"code": "hy", "name": "Armenian"}, {"code": "id", "name": "Indonesian"}, {"code": "is", "name": "Icelandic"}, {"code": "it", "name": "Italian"}, {"code": "ja", "name": "Japanese"}, {"code": "jv", "name": "Javanese"}, {"code": "ka", "name": "Georgian"}, {"code": "kk", "name": "Kazakh"}, {"code": "km", "name": "Khmer"}, {"code": "kn", "name": "Kannada"}, {"code": "ko", "name": "Korean"}, {"code": "lo", "name": "Lao"}, {"code": "lt", "name": "Lithuanian"}, {"code": "lv", "name": "Latvian"}, {"code": "mk", "name": "Macedonian"}, {"code": "ml", "name": "Malayalam"}, {"code": "mn", "name": "Mongolian"}, {"code": "mr", "name": "Marathi"}, {"code": "ms", "name": "Malay"}, {"code": "my", "name": "Burmese (Myanmar)"}, {"code": "nb", "name": "Norwegian"}, {"code": "ne", "name": "Nepali"}, {"code": "nl", "name": "Dutch"}, {"code": "no", "name": "Norwegian"}, {"code": "pa", "name": "Punjabi"}, {"code": "pl", "name": "Polish"}, {"code": "pt-BR", "name": "Portuguese (Brazil)"}, {"code": "pt-PT", "name": "Portuguese (Portugal)"}, {"code": "ro", "name": "Romanian"}, {"code": "ru", "name": "Russian"}, {"code": "rw", "name": "Kinyarwanda"}, {"code": "sd", "name": "Sindhi"}, {"code": "si", "name": "Sinhala"}, {"code": "sk", "name": "Slovak"}, {"code": "sl", "name": "Slovenian"}, {"code": "sq", "name": "Albanian"}, {"code": "sr", "name": "Serbian"}, {"code": "su", "name": "Sundanese"}, {"code": "sv", "name": "Swedish"}, {"code": "sw", "name": "Swahili"}, {"code": "ta", "name": "Tamil"}, {"code": "te", "name": "Telugu"}, {"code": "th", "name": "Thai"}, {"code": "tr", "name": "Turkish"}, {"code": "uk", "name": "Ukrainian"}, {"code": "ur", "name": "Urdu"}, {"code": "uz", "name": "Uzbek"}, {"code": "vi", "name": "Vietnamese"}, {"code": "zh-Hans", "name": "Chinese (Simplified)"}, {"code": "zh-Hant", "name": "Chinese (Traditional)"}, {"code": "zu", "name": "Zulu"}];
const codes = new Set(LANGUAGES.map(item => item.code));
export function matchLanguage(value) {
  if (!value || typeof value !== 'string') return null;
  const normalized = value.replaceAll('_', '-');
  const exact = LANGUAGES.find(item => item.code.toLowerCase() === normalized.toLowerCase());
  if (exact) return exact.code;
  const lower = normalized.toLowerCase(), base = lower.split('-')[0];
  if (base === 'zh') return /hant|tw|hk|mo/.test(lower) ? 'zh-Hant' : 'zh-Hans';
  if (base === 'pt') return lower === 'pt-pt' ? 'pt-PT' : 'pt-BR';
  if (base === 'iw') return 'he';
  return codes.has(base) ? base : null;
}
export function detectLanguage(preferences = []) {
  for (const value of preferences) { const match = matchLanguage(value); if (match) return match; }
  return 'en';
}
export async function browserLanguage() {
  const preferences = [];
  try { preferences.push(chrome.i18n.getUILanguage()); } catch { /* Used outside Chrome in tests. */ }
  try { preferences.push(...await chrome.i18n.getAcceptLanguages()); } catch { /* UI language is sufficient. */ }
  return detectLanguage(preferences);
}
// A small, predictable default list. Any selected uncommon language is pinned.
export const PRIMARY_LANGUAGES = ['ru','en','es','de','fr','it','pt-BR','zh-Hans','ja','ko','tr','uk'];
export function languageLabel(code, locale) {
  const name = new Intl.DisplayNames([locale], { type: 'language' }).of(code) || code;
  const [first, ...rest] = [...name];
  return first.toLocaleUpperCase(locale) + rest.join('');
}
export function languageItems(locale) {
  return LANGUAGES.filter(item => item.code !== 'nb').map(item => ({
    ...item, label: languageLabel(item.code, locale), native: languageLabel(item.code, item.code),
  })).sort((a,b) => a.label.localeCompare(b.label, locale));
}
export function populateLanguages(select, locale, current, automatic) {
  select.replaceChildren();
  const auto = document.createElement('option'); auto.value = 'auto'; auto.textContent = automatic; select.append(auto);
  const visible = new Set(PRIMARY_LANGUAGES);
  if (current !== 'auto') visible.add(current);
  for (const {code,label} of languageItems(locale).filter(item => visible.has(item.code))) {
    const option = document.createElement('option'); option.value = code; option.textContent = label;
    select.append(option);
  }
  select.value = current;
}
