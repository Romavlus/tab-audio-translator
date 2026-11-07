// SPDX-License-Identifier: 0BSD
// Connection ownership and retry policy specific to this extension.
import { GeminiWire, protocolFailure } from './gemini-wire.js';
import { RepetitionGuard } from './repetition-guard.js';
const INPUT_BYTES_PER_SECOND = 32000;
export class TranslationConnection {
  constructor({ apiKey, setup, onEvent = () => {}, onStatus = () => {}, makeWire = options => new GeminiWire(options), now = () => Date.now(), maxFailures = 6, retryBaseMs = 750 }) {
    Object.assign(this, { apiKey, setup, onEvent, onStatus, makeWire, now, maxFailures, retryBaseMs });
    this.phase = 'stopped'; this.epoch = 0; this.failures = 0;
    this.handshakes = new Set(); this.tail = []; this.tailBytes = 0;
    this.guard = new RepetitionGuard(); this.sourceGuard = new RepetitionGuard(); this.sourceRepeatAt = -Infinity; this.recoveries = [];
  }
  start() {
    if (this.phase !== 'stopped') return;
    this.phase = 'starting'; this.epoch++;
    void this.connect(false);
  }
  async connect(replacement) {
    const epoch = this.epoch;
    if (this.phase === 'stopped' || this.phase === 'failed') return;
    let wire;
    try {
      wire = this.makeWire({ apiKey: this.apiKey, setup: this.setup,
        onPacket: event => this.packet(wire, event),
        onDisconnect: error => this.disconnected(wire, error),
      });
      this.handshakes.add(wire);
      if (!replacement) this.onStatus('connecting');
      await wire.open();
      this.handshakes.delete(wire);
      if (epoch !== this.epoch || ['stopped','failed'].includes(this.phase)) { wire.close(); return; }
      if (replacement && this.primary) {
        this.candidate = wire;
        if (this.boundary || this.now() >= this.rotateAt) this.promote();
      } else {
        this.activate(wire, replacement);
      }
    } catch (problem) {
      this.handshakes.delete(wire); wire?.close();
      if (epoch !== this.epoch || ['stopped','failed'].includes(this.phase)) return;
      const error = protocolFailure(problem, this.apiKey);
      if (error.fatal) { this.finish(error); return; }
      // The old connection remains useful until its goAway deadline.
      if (replacement && this.primary) { this.rotationOpening = false; return; }
      this.retry(error);
    }
  }
  activate(wire, replayAll) {
    this.primary = wire; this.phase = 'streaming'; this.connectedAt = this.now();
    this.boundary = false; this.guard.reset(); this.sourceGuard.reset(); this.sourceRepeatAt = -Infinity;
    const oldest = this.now() - (replayAll ? 10000 : 2000);
    for (const entry of this.tail) if (entry.at >= oldest) wire.send(entry.buffer);
    this.onStatus('connected');
  }
  send(buffer) {
    if (['stopped','failed'].includes(this.phase) || !(buffer instanceof ArrayBuffer)) return;
    // Retain our own bytes: the caller may transfer its buffer to another node.
    const copy = buffer.slice(Math.max(0, buffer.byteLength - INPUT_BYTES_PER_SECOND * 10));
    this.tail.push({ buffer: copy, at: this.now() }); this.tailBytes += copy.byteLength;
    while (this.tail.length && (this.tailBytes > INPUT_BYTES_PER_SECOND * 10 || this.tail[0].at < this.now() - 10000)) this.tailBytes -= this.tail.shift().buffer.byteLength;
    this.boundary = false;
    this.primary?.send(buffer);
  }
  packet(wire, event) {
    if (wire !== this.primary || this.phase !== 'streaming') return;
    if (this.now() - this.connectedAt > 1000 && ['audio','input','output'].includes(event.type)) this.failures = 0;
    if (event.type === 'rotate') { this.prepareRotation(event.milliseconds); return; }
    if (event.type === 'turnComplete') {
      this.tail = []; this.tailBytes = 0; this.boundary = true; this.guard.finish(); this.sourceGuard.finish();
      this.onEvent(event); if (this.candidate) this.promote(); return;
    }
    if (event.type === 'interrupted') { this.onEvent({type:'clearAudio'}); return; }
    if (event.type === 'input' && this.sourceGuard.push(event.text, event.finished)) this.sourceRepeatAt = this.now();
    if (event.type === 'output' && this.guard.push(event.text, event.finished) && this.now() - this.sourceRepeatAt > 30000) {
      this.recover('repetition'); return;
    }
    this.onEvent(event);
  }
  prepareRotation(milliseconds) {
    if (this.rotationOpening || this.candidate) return;
    clearTimeout(this.rotationTimer);
    this.rotationOpening = true;
    this.rotateAt = this.now() + Math.max(0, milliseconds - Math.min(1500, milliseconds / 4));
    this.rotationTimer = setTimeout(() => {
      this.rotationTimer = null;
      if (this.candidate) this.promote();
      else if (this.primary) {
        this.primary.close(); this.primary = null;
        // A handshake already in progress will be activated when it finishes.
        if (!this.handshakes.size) { this.rotationOpening = false; void this.connect(false); }
      }
    }, Math.max(0, this.rotateAt - this.now()));
    void this.connect(true);
  }
  promote() {
    if (!this.candidate) return;
    const next = this.candidate; this.candidate = null;
    this.primary?.close(); this.primary = null;
    clearTimeout(this.rotationTimer); this.rotationTimer = null; this.rotationOpening = false;
    this.onEvent({ type: 'turnComplete' }); this.activate(next, true);
  }
  disconnected(wire, error) {
    if (['stopped','failed'].includes(this.phase)) return;
    if (wire === this.candidate) {
      this.candidate = null; this.rotationOpening = false;
      if (error.fatal) this.finish(error);
      return;
    }
    if (wire !== this.primary || ['stopped','failed'].includes(this.phase)) return;
    this.primary = null;
    if (error.fatal) { this.finish(error); return; }
    if (this.candidate) { this.promote(); return; }
    if (this.handshakes.size) return;
    this.retry(error);
  }
  retry(error) {
    clearTimeout(this.rotationTimer); this.rotationTimer = null; this.rotationOpening = false;
    this.failures++;
    if (this.failures >= this.maxFailures) { this.finish(error); return; }
    this.phase = 'waiting'; this.onStatus('disconnected', error.message);
    this.retryTimer = setTimeout(() => { this.retryTimer = null; void this.connect(false); }, Math.min(15000, this.retryBaseMs * 2 ** (this.failures - 1)));
  }
  recover(reason) {
    if (['stopped','failed'].includes(this.phase)) return;
    const at = this.now(); this.recoveries = this.recoveries.filter(time => at - time < 60000);
    this.recoveries.push(at);
    if (this.recoveries.length > 3) { this.finish(new Error('Translation repeatedly fell behind or looped. Start it again.')); return; }
    this.cancelConnections(); this.tail = []; this.tailBytes = 0; this.guard.reset();
    this.phase = 'starting'; this.onEvent({ type: 'reset', reason }); void this.connect(false);
  }
  finish(error) {
    this.cancelConnections(); this.phase = 'failed'; this.tail = []; this.tailBytes = 0;
    this.onStatus('failed', error.category === 'quota' ? 'Gemini quota exceeded. Check your project quotas.' : error.category === 'model' ? 'The selected Gemini model is no longer available.' : error.message);
  }
  cancelConnections() {
    this.epoch++; clearTimeout(this.retryTimer); clearTimeout(this.rotationTimer);
    this.retryTimer = this.rotationTimer = null; this.rotationOpening = false;
    for (const wire of new Set([this.primary, this.candidate, ...this.handshakes])) wire?.close();
    this.primary = this.candidate = null; this.handshakes.clear();
  }
  close() {
    this.phase = 'stopped'; this.cancelConnections(); this.tail = []; this.tailBytes = 0; this.apiKey = '';
  }
}
