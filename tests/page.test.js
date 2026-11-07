import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const code = readFileSync(new URL('../extension/content/page.js', import.meta.url), 'utf8');
function page() {
  const listeners = new Map(), messages = new Set(), hosts = [];
  let valid = true, calls = 0, send = () => Promise.resolve();
  class Media {}
  const runtime = {
    get id() { return valid ? 'test-extension' : undefined; },
    sendMessage(message) { calls++; return send(message); },
    onMessage: { addListener: listener => messages.add(listener), removeListener: listener => messages.delete(listener) },
  };
  const document = {
    addEventListener(name, fn, { signal }) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
      signal.addEventListener('abort', () => listeners.get(name).delete(fn), { once: true });
    },
    querySelectorAll: () => [],
    createElement() { return { setAttribute() {}, attachShadow: () => ({ append() {} }), remove() { this.removed = true; } }; },
    documentElement: { append(host) { hosts.push(host); host.parentNode = this; } },
  };
  const context = vm.createContext({ chrome: { runtime }, document, AbortController, HTMLMediaElement: Media, setTimeout, clearTimeout });
  vm.runInContext(code, context);
  return {
    inject: () => vm.runInContext(code, context),
    emit: name => { for (const fn of [...listeners.get(name) || []]) fn({ target: new Media() }); },
    show: () => { for (const fn of messages) fn({ target: 'translator-page', type: 'captions', text: 'Перевод', enabled: true }, { id: 'test-extension' }); },
    invalidate: () => { valid = false; }, setSend: fn => { send = fn; },
    calls: () => calls, count: () => [...listeners.values()].reduce((n, set) => n + set.size, 0),
    messages, hosts, dispose: () => context.__tabTranslatorPageBridge?.dispose(),
  };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
test('synchronous context invalidation removes old handlers and subtitles without throwing', async () => {
  const p = page(); p.show(); p.setSend(() => { throw new Error('Extension context invalidated.'); });
  assert.doesNotThrow(() => p.emit('pause')); await settle();
  assert.equal(p.calls(), 1); assert.equal(p.count(), 0); assert.equal(p.messages.size, 0);
  assert.equal(p.hosts[0].removed, true); p.emit('playing'); assert.equal(p.calls(), 1);
});
test('asynchronous invalidation also cleans up without an unhandled rejection', async () => {
  const p = page(); p.setSend(() => Promise.reject(new Error('Extension context invalidated.')));
  p.emit('pause'); await settle(); assert.equal(p.count(), 0); assert.equal(p.messages.size, 0);
});
test('an already invalid context is not messaged, including on fullscreen changes', () => {
  const p = page(); p.invalidate(); assert.doesNotThrow(() => p.emit('fullscreenchange'));
  assert.equal(p.calls(), 0); assert.equal(p.count(), 0);
});
test('reinjection does not duplicate active media handlers', async () => {
  const p = page(); p.inject(); assert.equal(p.count(), 5); assert.equal(p.messages.size, 1);
  p.emit('pause'); await settle(); assert.equal(p.calls(), 1); p.dispose();
});
test('a transient missing receiver is tolerated and a later event is still delivered', async () => {
  const p = page(); p.setSend(() => Promise.reject(new Error('Could not establish connection. Receiving end does not exist.')));
  p.emit('pause'); await settle(); assert.equal(p.count(), 5);
  p.setSend(() => Promise.resolve()); p.emit('pause'); await settle(); assert.equal(p.calls(), 2); p.dispose();
});
