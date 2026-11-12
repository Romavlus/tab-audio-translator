import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const script = readFileSync(new URL('../youtube-gemini-voice.user.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
let assertions = 0;
const ok = (condition, message) => { assert.ok(condition, message); assertions++; };
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Test-only access to the otherwise closed shadow root; not shipped in the script.
  await page.addInitScript(() => {
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (options) {
      const root = attach.call(this, options);
      if (this.id === 'yt-gemini-voice') window.testRoot = root;
      return root;
    };
    window.mock = { calls: [], aborted: 0, code: 200, delay: 5, storage: {}, pending: 0 };
    const startAudio = AudioBufferSourceNode.prototype.start;
    const stopAudio = AudioBufferSourceNode.prototype.stop;
    window.audioEvents = { started: 0, stopped: 0 };
    AudioBufferSourceNode.prototype.start = function (...args) { window.audioEvents.started++; return startAudio.apply(this, args); };
    AudioBufferSourceNode.prototype.stop = function (...args) { window.audioEvents.stopped++; return stopAudio.apply(this, args); };
    window.GM = {
      async getValue(k, fallback) { return window.mock.storage[k] ?? fallback; },
      async setValue(k, v) { window.mock.storage[k] = v; },
      async deleteValue(k) { delete window.mock.storage[k]; },
      xmlHttpRequest(details) {
        const mock = window.mock;
        mock.calls.push({ url: details.url, method: details.method, body: details.data && JSON.parse(details.data),
          key: !!details.headers['x-goog-api-key'] });
        mock.pending++;
        const timer = setTimeout(() => {
          mock.pending--;
          let body;
          if (details.url.includes('/api/timedtext')) body = { events: [
            { tStartMs: 0, dDurationMs: 6000, segs: [{ utf8: 'Hello world. This is a video about agents.' }] },
            { tStartMs: 6000, dDurationMs: 6000, segs: [{ utf8: 'They help with repetitive tasks.' }] },
            { tStartMs: 12000, dDurationMs: 12000, segs: [{ utf8: 'Here is another practical example.' }] },
            { tStartMs: 24000, dDurationMs: 12000, segs: [{ utf8: 'The third example is useful.' }] },
            { tStartMs: 72000, dDurationMs: 12000, segs: [{ utf8: 'Do not generate this in a minute test.' }] }
          ] };
          else if (details.method === 'GET') body = { models: [
            { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-3.8-flash-tts', supportedGenerationMethods: ['generateContent'] }
          ] };
          else if (details.url.includes('-tts:')) {
            // Real PCM sine wave, decoded and played through a real browser AudioContext.
            const pcm = new Uint8Array(24000 * 2 * 2), dv = new DataView(pcm.buffer);
            for (let i = 0; i < pcm.length / 2; i++) dv.setInt16(i * 2, Math.sin(i / 24000 * 2 * Math.PI * 440) * 5000, true);
            let binary = ''; for (const byte of pcm) binary += String.fromCharCode(byte);
            body = { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: btoa(binary) } }] } }] };
          } else body = { candidates: [{ content: { parts: [{ text: 'Привет! Это русский голосовой перевод.' }] } }] };
          details.onload({ status: details.url.includes('googleapis') ? mock.code : 200,
            responseText: mock.emptyCaptions && details.url.includes('timedtext') ? '' : JSON.stringify(body) });
        }, mock.delay);
        return { abort() { clearTimeout(timer); mock.pending--; mock.aborted++; details.onabort(); } };
      }
    };
  });
  const player = { videoDetails: { videoId: 'test-video' }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [
    { baseUrl: 'https://www.youtube.com/api/timedtext?v=test-video&lang=de', languageCode: 'de', name: { simpleText: 'German' } },
    { baseUrl: '/api/timedtext?v=test-video&lang=en', languageCode: 'en', name: { simpleText: 'English' } }
  ] } } };
  await page.route('https://www.youtube.com/**', route => route.fulfill({ status: 200, contentType: 'text/html',
    body: `<html><body><video controls></video><script>var ytInitialPlayerResponse = ${JSON.stringify(player)};</script></body></html>` }));
  await page.goto('https://www.youtube.com/watch?v=test-video');
  console.log('Fixture page loaded');
  // A canvas MediaStream makes video.play/pause/seek usable without external media or ffmpeg.
  // Use a tiny local video fixture when present, otherwise generate it via ffmpeg first.
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const tmp = mkdtempSync(join(tmpdir(), 'yt-voice-test-'));
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=5', '-t', '90', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(tmp, 'fixture.mp4')]);
    const data = readFileSync(join(tmp, 'fixture.mp4'));
    await page.route('https://www.youtube.com/fixture.mp4', route => {
      const range = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);
      if (!range) return route.fulfill({ contentType: 'video/mp4', headers: { 'accept-ranges': 'bytes' }, body: data });
      const start = +range[1], end = range[2] ? Math.min(+range[2], data.length - 1) : data.length - 1;
      return route.fulfill({ status: 206, contentType: 'video/mp4', headers: {
        'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${data.length}` }, body: data.subarray(start, end + 1) });
    });
    await page.evaluate(() => { document.querySelector('video').src = '/fixture.mp4'; });
    await page.waitForFunction(() => document.querySelector('video').readyState >= 2);
    console.log('Fixture video loaded');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  await page.addScriptTag({ content: script });
  console.log('Userscript loaded');
  const el = id => page.evaluateHandle(id => window.testRoot.getElementById(id), id);
  const click = async id => { await (await el(id)).asElement().click(); };
  const status = () => page.evaluate(() => window.testRoot.getElementById('status').textContent);
  const waitStatus = async text => {
    try { await page.waitForFunction(text => window.testRoot.getElementById('status').textContent.includes(text), text, { timeout: 10000 }); }
    catch (error) { throw new Error(`Expected status ${text}; got ${await status()}; video ${await page.evaluate(() => {
      const v = document.querySelector('video'); return JSON.stringify({ time: v.currentTime, duration: v.duration, paused: v.paused, seeking: v.seeking });
    })}`, { cause: error }); }
  };
  await page.waitForTimeout(50);
  await click('test'); await waitStatus('вставь Gemini');
  ok((await page.evaluate(() => mock.calls.length)) === 0, 'missing key never sends requests');
  await (await el('key')).asElement().fill('TEST-KEY-not-real');
  await click('check'); await waitStatus('Ключ принят');
  ok(await page.evaluate(() => !mock.storage.apiKey), 'key not persisted by default');
  ok(await page.evaluate(() => mock.calls.every(c => c.key === c.url.includes('googleapis'))), 'key is sent only to Google');
  await click('test'); await waitStatus('Первый фрагмент готов');
  ok(await page.evaluate(() => mock.calls.find(c => c.url.includes('timedtext')).url.includes('lang=en')), 'automatic track prefers English over first track');
  ok(await page.evaluate(() => mock.calls.find(c => c.url.includes('timedtext')).url.startsWith('https://www.youtube.com/api/timedtext?')), 'relative mobile caption URL resolves against YouTube origin');
  ok(await page.evaluate(() => mock.calls.filter(c => c.method === 'POST').length === 2), 'start prepares one block using translation + voice');
  await click('resume'); await waitStatus('Озвучка ·');
  await page.waitForTimeout(250);
  ok(await page.evaluate(() => audioEvents.started > 0), 'generated PCM actually starts through Web Audio');
  ok(await page.evaluate(() => document.querySelector('video').muted), 'original muted while dubbing');
  ok(await page.evaluate(() => testRoot.getElementById('caption').textContent.includes('русский')), 'Russian translation displayed');
  const stoppedBefore = await page.evaluate(() => audioEvents.stopped);
  await page.evaluate(() => document.querySelector('video').pause());
  const count = await page.evaluate(() => mock.calls.length);
  await page.waitForTimeout(400);
  ok((await page.evaluate(() => mock.calls.length)) === count, 'pause does not create extra paid requests');
  ok((await page.evaluate(() => audioEvents.stopped)) > stoppedBefore, 'video pause stops the audio source');
  await page.evaluate(() => { document.querySelector('video').currentTime = 13; });
  await click('resume'); await waitStatus('фрагмент 2/');
  ok(await page.evaluate(() => mock.calls.filter(c => c.method === 'POST').every(c => !JSON.stringify(c.body).includes('Do not generate'))), 'minute test does not generate distant blocks');
  await page.evaluate(() => { document.querySelector('video').currentTime = 61; });
  await waitStatus('Минутный тест завершён');
  ok(await page.evaluate(() => !document.querySelector('video').muted && document.querySelector('video').paused), 'test limit pauses video and restores mute');
  await page.evaluate(() => { document.querySelector('video').currentTime = 0; mock.code = 429; });
  await click('test'); await waitStatus('HTTP 429');
  ok(!(await status()).includes('TEST-KEY'), 'API errors do not reveal key');
  const after429 = await page.evaluate(() => mock.calls.length);
  await page.waitForTimeout(400);
  ok((await page.evaluate(() => mock.calls.length)) === after429, 'quota errors do not retry');
  await page.evaluate(() => { mock.code = 200; mock.delay = 1500; });
  await click('test'); await page.waitForTimeout(100); await click('stop');
  await page.waitForTimeout(1600);
  ok((await status()).includes('Остановлено'), 'stopped requests cannot restart playback or overwrite status');
  ok(await page.evaluate(() => mock.aborted > 0 && mock.pending === 0), 'stop aborts in-flight requests');
  ok(await page.evaluate(() => !testRoot.getElementById('diagnostics').value.includes('TEST-KEY')), 'diagnostics exclude key');
  await page.evaluate(() => { mock.delay = 5; testRoot.getElementById('remember').checked = true; });
  await click('check'); await waitStatus('Ключ принят');
  ok(await page.evaluate(() => mock.storage.apiKey === 'TEST-KEY-not-real'), 'explicit opt-in persists key');
  await click('forget'); await waitStatus('Ключ удалён');
  ok(await page.evaluate(() => !mock.storage.apiKey && !testRoot.getElementById('key').value), 'forget removes saved and visible key');
  await (await el('file')).asElement().setInputFiles({ name: 'test.srt', mimeType: 'text/plain', buffer: Buffer.from('1\n00:00:00,000 --> 00:00:12,000\nHello <b>world</b> &amp; friends.\n\n2\n00:00:12,000 --> 00:00:24,000\nThe second example.\n') });
  await waitStatus('Загружено 2 строк');
  await (await el('key')).asElement().fill('TEST-KEY-not-real');
  const captionCalls = await page.evaluate(() => mock.calls.filter(c => c.url.includes('timedtext')).length);
  await page.evaluate(() => { document.querySelector('video').currentTime = 0; });
  await click('test'); await waitStatus('Первый фрагмент готов');
  ok((await page.evaluate(() => mock.calls.filter(c => c.url.includes('timedtext')).length)) === captionCalls, 'SRT import avoids YouTube caption access');
  ok(await page.evaluate(() => mock.calls.filter(c => c.method === 'POST' && !c.url.includes('-tts:')).at(-1).body.contents[0].parts[0].text === 'Hello world & friends.'), 'SRT markup and entities become plain text');
  await click('resume'); await waitStatus('Озвучка ·');
  await page.evaluate(() => history.pushState({}, '', '/watch?v=another-video'));
  await waitStatus('Ролик сменился');
  ok(await page.evaluate(() => document.querySelector('video').paused), 'SPA navigation stops the previous video session');
  await (await el('file')).asElement().setInputFiles({ name: 'bad.srt', mimeType: 'text/plain', buffer: Buffer.from('Text without timestamps') });
  await waitStatus('Не найдены субтитры');
  ok(true, 'invalid subtitle files report a clear error');
  const playerURL = 'https://www.youtube.com/api/timedtext?v=another-video&lang=en&pot=fixture-proof&fmt=json3';
  await page.route(playerURL, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ events: [
    { tStartMs: 0, dDurationMs: 12000, segs: [{ utf8: 'Actual player captions with runtime authorization.' }] }
  ] }) }));
  // Mimic the successful caption request made by a running YouTube player.
  await page.evaluate(url => fetch(url).then(r => r.text()), playerURL);
  await page.waitForFunction(url => performance.getEntriesByName(url).length > 0, playerURL);
  const beforePlayerRead = await page.evaluate(() => mock.calls.length);
  await click('test'); await waitStatus('Первый фрагмент готов');
  ok(await page.evaluate(() => JSON.parse(testRoot.getElementById('diagnostics').value).captionSource === 'player-request'), 'uses actual player caption request when bare timedtext is empty');
  ok(await page.evaluate(n => mock.calls.slice(n).every(c => c.url.includes('googleapis')), beforePlayerRead), 'player captions use page fetch without GM request or Gemini key');
  ok(await page.evaluate(() => mock.calls.filter(c => c.method === 'POST' && !c.url.includes('-tts:')).at(-1).body.contents[0].parts[0].text.includes('runtime authorization')), 'player caption response reaches translation');
  await click('stop');
  await page.evaluate(() => { history.pushState({}, '', '/watch?v=test-video'); mock.emptyCaptions = true; });
  await page.waitForTimeout(500);
  const paidBeforeEmpty = await page.evaluate(() => mock.calls.filter(c => c.method === 'POST').length);
  await click('test'); await waitStatus('Не удалось получить текст от плеера');
  ok((await page.evaluate(() => mock.calls.filter(c => c.method === 'POST').length)) === paidBeforeEmpty, 'empty caption responses never trigger paid Gemini requests');
  ok(/видно запросов: \d+/.test(await status()), 'reports player request availability for real-device diagnosis');
  ok(errors.length === 0, `no browser exceptions: ${errors.join(', ')}`);
  console.log(`PASS: ${assertions} browser checks (mock Gemini/YouTube, real PCM/Web Audio). No paid API calls.`);
} finally { await browser.close(); }
