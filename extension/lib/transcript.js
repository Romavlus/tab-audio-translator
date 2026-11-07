export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export function selectFragments(rows, { now = Date.now(), end = now, minutes = null, kind = 'output' } = {}) {
  if (minutes !== null && (!Number.isFinite(minutes) || minutes <= 0)) throw new Error('Enter a number of minutes greater than zero.');
  const from = Math.max(now - WEEK_MS, minutes === null ? -Infinity : end - minutes * 60_000);
  return rows.filter(row => row.kind === kind && row.createdAt >= from && row.createdAt <= end)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}
export const plainText = rows => rows.map(row => row.text.trim()).filter(Boolean).join('\n\n');
export function safeSource(tab = {}) {
  let url = '';
  try { const parsed = new URL(tab.url); if (['http:', 'https:', 'file:'].includes(parsed.protocol)) {
    parsed.username = ''; parsed.password = ''; parsed.hash = ''; url = parsed.href;
  }} catch { /* Restricted tabs do not expose a URL. */ }
  return { title: String(tab.title || 'Tab with audio').slice(0, 300), url };
}

// The API streams deltas; a finished event may contain the complete phrase.
// Keep input and output independently: their sentence boundaries need not match.
export class Transcript {
  constructor({ sessionId, startedAt, emit, now = Date.now, idleMs = 1400, maxMs = 12000 }) {
    Object.assign(this, { sessionId, startedAt, emit, now, idleMs, maxMs });
    this.open = new Map();
  }
  push(kind, text, finished = false) {
    if (!['input', 'output'].includes(kind)) return;
    if (typeof text !== 'string' || !text) { if (finished) this.finish(kind); return; }
    let entry = this.open.get(kind);
    if (entry && this.now() - entry.row.createdAt >= this.maxMs) { this.finish(kind); entry = null; }
    if (!entry) {
      const at = this.now();
      entry = { row: { id: crypto.randomUUID(), sessionId: this.sessionId, kind, text: '', createdAt: at, offsetMs: at - this.startedAt, finalized: false }, timer: null };
      this.open.set(kind, entry);
    }
    entry.row.text = finished ? text : entry.row.text + text;
    entry.row.updatedAt = this.now();
    this.emit({ ...entry.row });
    clearTimeout(entry.timer);
    if (finished) this.finish(kind);
    else entry.timer = setTimeout(() => this.finish(kind), this.idleMs);
  }
  finish(kind) {
    const entry = this.open.get(kind);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.open.delete(kind);
    this.emit({ ...entry.row, finalized: true, updatedAt: this.now() });
  }
  finishAll() { for (const kind of [...this.open.keys()]) this.finish(kind); }
}
