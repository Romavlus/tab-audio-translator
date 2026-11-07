import { currentLocale } from './locale.js';
import { localizeRuntimeMessage } from './runtime-messages.js';
import { plainText, selectFragments } from './transcript.js';
export const $ = id => document.getElementById(id);
export async function rpc(type, extra = {}) {
  const response = await chrome.runtime.sendMessage({ target: 'worker', type, ...extra });
  if (!response?.ok) throw new Error(response?.error || 'The extension is not responding. Reopen the popup.');
  return response.data;
}
export function notify(text = '', error = false, element = $('message')) {
  element.textContent = localizeRuntimeMessage(text, currentLocale()); element.hidden = !text; element.classList.toggle('error', error);
}
export const dateTime = value => new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(value);
export function offset(value) {
  const seconds = Math.max(0, Math.floor(value / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
export function renderTranscript(container, rows) {
  const selection = document.getSelection();
  const selected = selection && !selection.isCollapsed && container.contains(selection.anchorNode);
  const stick = container.scrollHeight - container.scrollTop - container.clientHeight < 45;
  const existing = new Map([...container.children].map(child => [child.dataset.id, child]));
  const ids = new Set(rows.map(row => row.id));
  for (const [id, element] of existing) if (!ids.has(id) && !selected) element.remove();
  for (const row of rows) {
    let element = existing.get(row.id);
    if (!element) {
      element = document.createElement('p'); element.dataset.id = row.id;
      const time = document.createElement('span'); time.className = 'timestamp'; time.textContent = offset(row.offsetMs || 0);
      const text = document.createElement('span'); text.className = 'phrase';
      element.append(time, text); container.append(element);
    }
    const phrase = element.querySelector('.phrase');
    if (phrase.textContent !== row.text && !selected) phrase.textContent = row.text;
  }
  if (stick && !selected) container.scrollTop = container.scrollHeight;
}
export async function copyRows(rows, { kind = 'output', minutes = null, end = Date.now() } = {}) {
  const text = plainText(selectFragments(rows, { kind, minutes, end }));
  if (!text) throw new Error('No text in the selected period.');
  await navigator.clipboard.writeText(text);
  return 'Text copied.';
}
export const STATUS = {
  idle: 'Ready to translate', connecting: 'Connecting to Gemini…', connected: 'Translating',
  disconnected: 'Reconnecting…', error: 'Trying to reconnect…',
  failed: 'Could not continue', stopped: 'Translation stopped', paused: 'Video paused',
};
