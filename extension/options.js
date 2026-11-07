import { applyLocale, interfaceLocale, currentLocale, text as t } from './lib/locale.js';
import { $, rpc, notify, dateTime, offset, renderTranscript, copyRows } from './lib/ui.js';
import { listSessions, getSession, getFragments, deleteSession, clearArchive, cleanupArchive } from './lib/archive.js';
import { selectFragments } from './lib/transcript.js';
let sessions = [], selectedId = null, kind = 'output', rows = [], selectedSession;
let selectionVersion = 0;
function domain(url) { try { return new URL(url).hostname || t('chooseTab'); } catch { return t('chooseTab'); } }
function drawSessions() {
  const query = $('search').value.trim().toLocaleLowerCase(currentLocale());
  const filtered = sessions.filter(session => `${session.title} ${domain(session.url)}`.toLocaleLowerCase(currentLocale()).includes(query));
  $('sessions').replaceChildren();
  $('empty-archive').hidden = filtered.length > 0;
  $('empty-archive').textContent = sessions.length ? t('noMatch') : t('noSessions');
  for (const session of filtered) {
    const button = document.createElement('button'); button.className = `session-item ${session.id === selectedId ? 'selected' : ''}`;
    button.setAttribute('aria-pressed', String(session.id === selectedId));
    const title = document.createElement('strong'); title.textContent = session.title;
    const meta = document.createElement('span'); meta.textContent = `${new Intl.DateTimeFormat(currentLocale(), {dateStyle:'medium',timeStyle:'short'}).format(session.startedAt)} · ${domain(session.url)}`;
    button.append(title, meta); button.addEventListener('click', () => void selectSession(session.id)); $('sessions').append(button);
  }
}
async function selectSession(id, keepScroll = false) {
  const version = ++selectionVersion;
  const [session, fragments] = await Promise.all([getSession(id), getFragments(id)]);
  if (version !== selectionVersion) return;
  selectedId = session ? id : null; selectedSession = session; rows = fragments;
  $('session-content').hidden = !session; $('no-selection').hidden = Boolean(session);
  if (!session) return;
  if (!keepScroll) { $('archive-text').replaceChildren(); $('archive-text').scrollTop = 0; }
  $('session-title').textContent = session.title;
  const state = await rpc('snapshot');
  const isActive = state.state.running && state.state.sessionId === id;
  $('session-meta').textContent = `${new Intl.DateTimeFormat(currentLocale(), {dateStyle:'medium',timeStyle:'short'}).format(session.startedAt)} · ${isActive ? t('active') : offset((session.endedAt || session.updatedAt) - session.startedAt)}${session.status === 'interrupted' ? ` · ${t('interrupted')}` : ''}`;
  $('session-link').hidden = !/^https?:/.test(session.url);
  $('session-link').href = /^https?:/.test(session.url) ? session.url : '#';
  renderText(); drawSessions();
}
function renderText() {
  const filtered = selectFragments(rows, { kind });
  renderTranscript($('archive-text'), filtered); $('empty-session').hidden = filtered.length > 0;
  for (const [id, type] of [['show-output', 'output'], ['show-input', 'input']]) {
    $(id).classList.toggle('selected', type === kind); $(id).setAttribute('aria-pressed', String(type === kind));
  }
}
async function refresh() {
  try {
    await rpc('flush'); await cleanupArchive(); sessions = await listSessions();
    if (selectedId && sessions.some(session => session.id === selectedId)) await selectSession(selectedId, true);
    else if (sessions.length) await selectSession(sessions[0].id);
    else { selectedId = null; selectedSession = null; rows = []; $('session-content').hidden = true; $('no-selection').hidden = false; }
    drawSessions();
  } catch (error) { notify(error.message, true); }
}
for (const [id, value] of [['show-output', 'output'], ['show-input', 'input']]) $(id).addEventListener('click', () => {
  kind = value; $('archive-text').replaceChildren(); renderText();
});
$('search').addEventListener('input', drawSessions);
$('refresh-archive').addEventListener('click', refresh);
async function canDelete(id) {
  const { state } = await rpc('snapshot');
  if (state.running && (!id || state.sessionId === id)) throw new Error(t('stopFirst'));
}
$('delete-session').addEventListener('click', async () => {
  try {
    if (!selectedId) return;
    await canDelete(selectedId);
    if (!confirm(t('confirmDelete'))) return;
    await deleteSession(selectedId); selectedId = null; await refresh(); notify(t('deleted'));
  } catch (error) { notify(error.message, true); }
});
$('clear-archive').addEventListener('click', async () => {
  try {
    await canDelete();
    if (!confirm(t('confirmClear'))) return;
    await clearArchive(); selectedId = null; await refresh(); notify(t('cleared'));
  } catch (error) { notify(error.message, true); }
});
async function copy(minutes = null) {
  try {
    if (!selectedId) throw new Error(t('selectSession'));
    await rpc('flush'); rows = await getFragments(selectedId); selectedSession = await getSession(selectedId);
    try { await copyRows(rows, { kind, minutes, end: selectedSession?.endedAt || Date.now() }); } catch { throw new Error(t('copyEmpty')); }
    notify(t('copied'));
  } catch (error) { notify(error.message, true); }
}
$('copy-session').addEventListener('click', () => copy());
$('copy-archive-recent').addEventListener('click', () => copy(Number($('archive-minutes').value)));
try { const data = await rpc('snapshot'); applyLocale(data.settings.targetLanguage, data.settings); await refresh(); }
catch (error) { notify(error.message, true); }
// Follow target-language changes made in the popup without reloading the archive.
let activeLanguage = document.documentElement.lang;
setInterval(async () => {
  try {
    const { settings } = await rpc('snapshot');
    if (interfaceLocale(settings.targetLanguage) !== activeLanguage) {
      applyLocale(settings.targetLanguage, settings); activeLanguage = document.documentElement.lang; await refresh();
    }
  } catch { /* Keep saved text available during transient worker restarts. */ }
}, 2000);
