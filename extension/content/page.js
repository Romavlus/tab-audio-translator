// Runs in Chrome's isolated world; it never receives settings or an API key.
(() => {
  const key = '__tabTranslatorPageBridge';
  const extensionId = chrome.runtime.id;
  if (globalThis[key]?.active && globalThis[key].extensionId === extensionId) return;
  globalThis[key]?.dispose();
  const controller = new AbortController();
  const bridge = { active: true, extensionId, dispose };
  globalThis[key] = bridge;
  let host, textNode, timeout;
  function remove() { clearTimeout(timeout); host?.remove(); host = textNode = null; }
  function contextAvailable() {
    try { return bridge.active && chrome.runtime.id === extensionId; }
    catch { return false; }
  }
  function dispose() {
    bridge.active = false;
    controller.abort();
    remove();
    try { chrome.runtime.onMessage.removeListener(onMessage); } catch { /* Old extension context. */ }
    if (globalThis[key] === bridge) delete globalThis[key];
  }
  function show(text) {
    if (!host) {
      host = document.createElement('div'); host.setAttribute('data-tab-translator', '');
      const root = host.attachShadow({ mode: 'closed' });
      const style = document.createElement('style');
      style.textContent = ':host{all:initial;position:fixed!important;inset:auto 20px 7vh!important;z-index:2147483647!important;pointer-events:none!important;display:flex!important;justify-content:center!important}p{margin:0;max-width:min(900px,90vw);padding:12px 20px;border:1px solid #a5baff45;border-radius:14px;background:rgba(28,34,61,.92);color:#fff;font:500 23px/1.45 system-ui,sans-serif;text-align:center;white-space:pre-wrap;overflow-wrap:anywhere;box-shadow:0 3px 20px #17245233;max-height:28vh;overflow:hidden}';
      textNode = document.createElement('p'); textNode.setAttribute('role', 'status'); textNode.setAttribute('aria-live', 'polite');
      root.append(style, textNode);
    }
    const parent = document.fullscreenElement || document.documentElement;
    if (host.parentNode !== parent) parent.append(host);
    textNode.textContent = String(text).slice(-1200);
    clearTimeout(timeout); timeout = setTimeout(remove, 10000);
  }
  function onMessage(message, sender) {
    if (!contextAvailable()) { dispose(); return; }
    if (sender.id !== extensionId || message.target !== 'translator-page') return;
    if (message.type === 'captions') {
      if (message.enabled && message.text) show(message.text); else remove();
    }
  }
  chrome.runtime.onMessage.addListener(onMessage);
  document.addEventListener('fullscreenchange', () => {
    if (!contextAvailable()) { dispose(); return; }
    if (textNode) show(textNode.textContent);
  }, { signal: controller.signal });
  async function media(action) {
    try {
      if (!contextAvailable()) { dispose(); return; }
      // try/await handles both synchronous throws and rejected promises.
      await chrome.runtime.sendMessage({ target: 'worker', type: 'media', action });
    } catch (error) {
      if (!contextAvailable() || /extension context invalidated/i.test(String(error?.message))) dispose();
      // A transient missing receiver must not break playback or leak a rejection.
    }
  }
  const playing = () => [...document.querySelectorAll('video,audio')].some(element => !element.paused && !element.ended);
  document.addEventListener('pause', event => {
    if (event.target instanceof HTMLMediaElement && !playing()) void media('pause');
  }, { capture: true, signal: controller.signal });
  document.addEventListener('seeking', event => {
    if (event.target instanceof HTMLMediaElement) void media('seeking');
  }, { capture: true, signal: controller.signal });
  for (const type of ['playing', 'seeked']) document.addEventListener(type, event => {
    if (event.target instanceof HTMLMediaElement && !event.target.paused) void media('play');
  }, { capture: true, signal: controller.signal });
})();
