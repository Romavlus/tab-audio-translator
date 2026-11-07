import { WEEK_MS } from './transcript.js';
const DB_NAME = 'tab-translator-archive';
let opening;
const result = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
const completed = tx => new Promise((resolve, reject) => {
  tx.oncomplete = resolve;
  tx.onerror = () => reject(tx.error || new Error('Could not save history.'));
  tx.onabort = () => reject(tx.error || new Error('Saving history was interrupted.'));
});
export function openArchive() {
  if (!opening) opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
      sessions.createIndex('startedAt', 'startedAt');
      const fragments = db.createObjectStore('fragments', { keyPath: 'id' });
      fragments.createIndex('sessionId', 'sessionId');
      fragments.createIndex('createdAt', 'createdAt');
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); opening = null; };
      resolve(db);
    };
    request.onerror = () => { opening = null; reject(request.error); };
    request.onblocked = () => { opening = null; reject(new Error('Close other history windows and try again.')); };
  });
  return opening;
}
export async function createSession(session) {
  const db = await openArchive();
  const tx = db.transaction('sessions', 'readwrite'); const done = completed(tx);
  tx.objectStore('sessions').add(session);
  await done;
}
export async function updateSession(id, patch) {
  const db = await openArchive();
  const tx = db.transaction('sessions', 'readwrite'); const done = completed(tx);
  const store = tx.objectStore('sessions');
  const session = await result(store.get(id));
  if (session) store.put({ ...session, ...patch, id });
  await done;
}
export async function saveFragments(rows, now = Date.now()) {
  if (!rows.length) return;
  const db = await openArchive();
  const tx = db.transaction(['sessions', 'fragments'], 'readwrite'); const done = completed(tx);
  // Prevent late writes from resurrecting a session deleted in the settings.
  const sessions = tx.objectStore('sessions'); const fragments = tx.objectStore('fragments');
  const ids = [...new Set(rows.map(row => row.sessionId))];
  const existing = new Map();
  await Promise.all(ids.map(async id => { const session = await result(sessions.get(id)); if (session) existing.set(id, session); }));
  for (const row of rows) if (existing.has(row.sessionId) && row.createdAt >= now - WEEK_MS) {
    fragments.put(row);
    const session = existing.get(row.sessionId);
    session.lastFragmentAt = Math.max(session.lastFragmentAt || 0, row.createdAt);
    session.updatedAt = Math.max(session.updatedAt || 0, row.updatedAt || row.createdAt);
  }
  for (const session of existing.values()) sessions.put(session);
  await done;
}
export async function getSession(id) {
  const db = await openArchive();
  return result(db.transaction('sessions').objectStore('sessions').get(id));
}
export async function getFragments(id, now = Date.now()) {
  const db = await openArchive();
  const rows = await result(db.transaction('fragments').objectStore('fragments').index('sessionId').getAll(id));
  return rows.filter(row => row.createdAt >= now - WEEK_MS)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}
export async function listSessions(now = Date.now()) {
  const db = await openArchive();
  const tx = db.transaction('sessions');
  const sessions = await result(tx.objectStore('sessions').getAll());
  return sessions.filter(session => session.startedAt >= now - WEEK_MS || session.lastFragmentAt >= now - WEEK_MS)
    .sort((a, b) => b.startedAt - a.startedAt);
}
export async function deleteSession(id) {
  const db = await openArchive();
  const tx = db.transaction(['sessions', 'fragments'], 'readwrite'); const done = completed(tx);
  tx.objectStore('sessions').delete(id);
  const request = tx.objectStore('fragments').index('sessionId').openCursor(IDBKeyRange.only(id));
  request.onsuccess = () => { const cursor = request.result; if (cursor) { cursor.delete(); cursor.continue(); } };
  await done;
}
export async function clearArchive() {
  const db = await openArchive();
  const tx = db.transaction(['sessions', 'fragments'], 'readwrite'); const done = completed(tx);
  tx.objectStore('sessions').clear(); tx.objectStore('fragments').clear(); await done;
}
export async function cleanupArchive(now = Date.now()) {
  const db = await openArchive(); const cutoff = now - WEEK_MS;
  const tx = db.transaction(['sessions', 'fragments'], 'readwrite'); const done = completed(tx);
  const fragments = tx.objectStore('fragments');
  const sessions = tx.objectStore('sessions');
  const request = fragments.index('createdAt').openCursor(IDBKeyRange.upperBound(cutoff, true));
  request.onsuccess = () => {
    const item = request.result;
    if (item) { item.delete(); item.continue(); return; }
    // Inspect metadata only after every old fragment has actually been deleted.
    const cursor = sessions.openCursor();
    cursor.onsuccess = () => {
      const session = cursor.result; if (!session) return;
      if (session.value.startedAt >= cutoff) return session.continue();
      const count = fragments.index('sessionId').count(session.key);
      count.onsuccess = () => { if (!count.result) session.delete(); session.continue(); };
    };
  };
  await done;
}
export async function recoverSessions(activeId, now = Date.now()) {
  const sessions = await listSessions(now);
  for (const session of sessions) if (!session.endedAt && session.id !== activeId) {
    await updateSession(session.id, { endedAt: session.updatedAt || session.startedAt, status: 'interrupted' });
  }
}
