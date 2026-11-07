// SPDX-License-Identifier: 0BSD
// Protocol implementation from the Gemini Live API specification.
export const PCM_INPUT_RATE = 16000;
const SOCKET_ADDRESS = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
export function translationSetup({ model, targetLanguage }) {
  const request = {
    model: `models/${model.replace(/^models\//, '')}`,
    generationConfig: { responseModalities: ['AUDIO'], translationConfig: { targetLanguageCode: targetLanguage, echoTargetLanguage: false } },
    inputAudioTranscription: {}, outputAudioTranscription: {},
  };
  return { setup: request };
}
export function encodePCM(buffer) {
  const bytes = new Uint8Array(buffer);
  const pieces = [];
  for (let offset = 0; offset < bytes.length; offset += 8192) pieces.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
  return btoa(pieces.join(''));
}
export function decodePCM(encoded) {
  const binary = atob(encoded.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(binary, character => character.charCodeAt(0)).buffer;
}
export function protocolFailure(value, secret = '') {
  const raw = String(value?.message || value?.reason || value || 'Connection error');
  const safe = (secret ? raw.replaceAll(secret, '[hidden]').replaceAll(encodeURIComponent(secret), '[hidden]') : raw)
    .replace(/([?&](?:key|access_token)=)[^\s&]+/gi, '$1[hidden]').slice(0, 500);
  const status = Number(value?.code || value?.statusCode || 0);
  const quota = status === 429 || /quota|resource_exhausted|rate.limit/i.test(raw);
  const access = [400,401,403].includes(status) || /api.key|permission_denied|unauthenticated|access.denied|invalid.argument/i.test(raw);
  const model = /model/i.test(raw) && /not.found|not.supported|retired|deprecated|discontinued/i.test(raw);
  const error = new Error(safe); error.category = ['quota','model','access','network'].includes(value?.category) ? value.category : quota ? 'quota' : model ? 'model' : access ? 'access' : 'network';
  error.fatal = error.category !== 'network';
  return error;
}
export class GeminiWire {
  constructor({ apiKey, setup, onPacket = () => {}, onDisconnect = () => {}, socketFactory = url => new WebSocket(url), timeoutMs = 20000 }) {
    Object.assign(this, { apiKey, setup, onPacket, onDisconnect, socketFactory, timeoutMs });
    this.phase = 'new'; this.incoming = Promise.resolve();
  }
  open() {
    if (this.phase !== 'new') return Promise.reject(new Error('This connection has already been used.'));
    this.phase = 'opening';
    return new Promise((resolve, reject) => {
      this.finishHandshake = error => {
        if (!this.finishHandshake) return;
        this.finishHandshake = null; clearTimeout(this.handshakeTimer);
        error ? reject(error) : resolve(this);
      };
      this.handshakeTimer = setTimeout(() => this.fail(new Error('The Gemini connection timed out.')), this.timeoutMs);
      try {
        this.socket = this.socketFactory(`${SOCKET_ADDRESS}?key=${encodeURIComponent(this.apiKey)}`);
        this.socket.binaryType = 'arraybuffer';
        this.socket.onopen = () => {
          if (this.phase !== 'opening') return;
          try { this.socket.send(JSON.stringify(this.setup)); } catch (error) { this.fail(error); }
        };
        this.socket.onmessage = event => {
          this.incoming = this.incoming.then(async () => {
            if (this.phase === 'closed') return;
            let data = event.data;
            if (typeof data?.text === 'function') data = await data.text();
            else if (data instanceof ArrayBuffer) data = new TextDecoder().decode(data);
            if (this.phase === 'closed') return;
            this.receive(JSON.parse(data));
          }).catch(error => this.fail(error));
        };
        this.socket.onclose = event => this.fail({ message: event.reason || `Gemini: connection closed (${event.code}).`, code: event.code });
        // The browser does not disclose HTTP handshake details in this event.
        this.socket.onerror = () => this.fail(new Error('Cannot reach Gemini. Check your connection and API access.'));
      } catch (error) { this.fail(error); }
    });
  }
  receive(frame) {
    if (frame.error) { this.fail(frame.error); return; }
    if (frame.setupComplete && this.phase === 'opening') {
      this.phase = 'ready'; this.finishHandshake?.();
    }
    if (this.phase !== 'ready') return;
    if (frame.usageMetadata) this.onPacket({ type: 'usage', usage: frame.usageMetadata });
    if (frame.goAway) {
      const duration = String(frame.goAway.timeLeft || '1s');
      const milliseconds = /^\d+(\.\d+)?s$/.test(duration) ? Number(duration.slice(0, -1)) * 1000 : 1000;
      this.onPacket({ type: 'rotate', milliseconds });
    }
    const content = frame.serverContent;
    if (!content) return;
    for (const [field, type] of [['inputTranscription','input'],['outputTranscription','output']]) {
      if (content[field] && (content[field].text || content[field].finished)) {
        this.onPacket({ type, text: content[field].text || '', finished: Boolean(content[field].finished) });
      }
    }
    for (const part of content.modelTurn?.parts || []) {
      const media = part.inlineData;
      if (media?.data && /^audio\/pcm(?:;|$)/.test(media.mimeType || '')) this.onPacket({ type: 'audio', buffer: decodePCM(media.data) });
    }
    if (content.interrupted) this.onPacket({ type: 'interrupted' });
    if (content.turnComplete || content.generationComplete || content.interrupted) this.onPacket({ type: 'turnComplete' });
  }
  send(buffer) {
    if (this.phase !== 'ready') return false;
    try {
      if (this.socket.bufferedAmount > 256000) throw new Error('The network cannot upload audio fast enough. Reconnecting.');
      this.socket.send(JSON.stringify({ realtimeInput: { audio: { mimeType: `audio/pcm;rate=${PCM_INPUT_RATE}`, data: encodePCM(buffer) } } }));
      return true;
    } catch (error) { this.fail(error); return false; }
  }
  fail(problem) {
    if (this.phase === 'closed') return;
    const active = this.phase === 'ready';
    const error = protocolFailure(problem, this.apiKey);
    this.finishHandshake?.(error); this.detach();
    if (active) this.onDisconnect(error);
  }
  detach() {
    this.phase = 'closed'; clearTimeout(this.handshakeTimer);
    if (this.socket) {
      const socket = this.socket; this.socket = null;
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      try { socket.close(); } catch { /* Already closed. */ }
    }
    this.apiKey = '';
  }
  close() {
    this.finishHandshake?.(new Error('Connection cancelled.'));
    this.detach();
  }
}
