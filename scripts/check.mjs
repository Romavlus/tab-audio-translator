import { readdir, readFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(path.join(directory, entry.name)) : path.join(directory, entry.name)))).flat();
}
const all = await files('extension');
for (const file of all) {
  if (file.endsWith('.js')) execFileSync(process.execPath, ['--check', file]);
  if (file.endsWith('.html')) {
    const html = await readFile(file, 'utf8');
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>[^<]+/.test(html), `Inline script: ${file}`);
    for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      if (!/^https?:|^#/.test(match[1])) await access(path.resolve(path.dirname(file), match[1]));
    }
  }
}
const manifest = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
for (const file of [manifest.background.service_worker, manifest.action.default_popup, manifest.options_page, ...Object.values(manifest.icons)]) await access(`extension/${file}`);
for (const size of [16, 32, 48, 64, 128, 256]) {
  const png = await readFile(`extension/icons/icon-${size}.png`);
  assert.equal(png.readUInt32BE(16), size, `Icon width ${size}`);
  assert.equal(png.readUInt32BE(20), size, `Icon height ${size}`);
}
assert.ok(!manifest.permissions.includes('audioCapture'));
assert.ok(!manifest.permissions.includes('sidePanel'));
assert.deepEqual(manifest.host_permissions, ['https://generativelanguage.googleapis.com/*']);
console.log(`Checked ${all.length} extension files: syntax, entry points, CSP-compatible scripts and permissions.`);

assert.equal(manifest.default_locale, 'en');
for (const locale of ['en','ru']) {
  const messages=JSON.parse(await readFile(`extension/_locales/${locale}/messages.json`,'utf8'));
  for (const value of [manifest.name,manifest.description,manifest.action.default_title]) {
    const key=/^__MSG_(.+)__$/.exec(value)?.[1];
    assert.ok(key && messages[key]?.message, `Missing manifest translation: ${locale}/${key}`);
  }
}
