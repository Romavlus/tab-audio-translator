// SPDX-License-Identifier: 0BSD
// Read-only publication checks. Never stage files or print a matched secret.
import { access, readFile, stat, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const root=process.cwd(); let temporary;
try {
  let gitOptions=[];
  try { await access(path.join(root,'.git')); }
  catch {
    temporary=await mkdtemp(path.join(os.tmpdir(),'translator-publish-check-'));
    execFileSync('git',['init','--quiet','--initial-branch=main',temporary]);
    gitOptions=[`--git-dir=${path.join(temporary,'.git')}`,`--work-tree=${root}`];
  }
  const git=args=>execFileSync('git',['-c','core.excludesFile=/dev/null',...gitOptions,...args],{cwd:root,encoding:'utf8'});
  const files=[...new Set(git(['ls-files','--cached','--others','--exclude-standard','-z']).split('\0').filter(Boolean))].sort();
  const required=['.gitignore','README.md','LICENSE','package-lock.json','extension/manifest.json','extension/LICENSE','extension/PRIVACY.md','extension/LICENSING.md','docs/INSTALLATION.md','docs/GEMINI-KEY.md','docs/MEDIA.md','docs/screenshots/main.png','docs/screenshots/translating.png','docs/screenshots/settings.png','docs/screenshots/languages.png','docs/screenshots/history.png','RELEASE_NOTES.md','README.ru.md','RELEASE_NOTES.ru.md','docs/INSTALLATION.ru.md','docs/GEMINI-KEY.ru.md','docs/MEDIA.ru.md','extension/PRIVACY.ru.md','extension/LICENSING.ru.md'];
  for(const file of required) assert.ok(files.includes(file),`Missing publication file: ${file}`);
  const checks=[
    /AIza[0-9A-Za-z_-]{35}/,
    /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
    /\bgithub_pat_[A-Za-z0-9_]{30,}\b/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  ];
  for(const file of files) {
    assert.ok(!/(^|\/)(?:node_modules|legacy|backup[^/]*|reports|dist|test-results|playwright-report)(\/|$)/i.test(file),`Local-only content would be published: ${file}`);
    assert.ok(!/(^|\/)\.env(?:\.|$)/.test(file)||file.endsWith('.env.example'),`Environment file would be published: ${file}`);
    const info=await stat(file);assert.ok(info.size<10*1024*1024,`Unexpected large file: ${file}`);
    if(!/\.(?:png|gif|mp4)$/i.test(file)) {
      const text=await readFile(file,'utf8');
      assert.ok(!checks.some(pattern=>pattern.test(text)),`Possible credential in ${file}; value intentionally hidden`);
      assert.ok(!(/\/(?:Users|home)\/[A-Za-z0-9_.-]+/).test(text),`Private local path in ${file}`);
    }
    if(file.endsWith('.md')) {
      const markdown=await readFile(file,'utf8');
      const links=[...markdown.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)].map(match=>match[1]);
      for(const match of markdown.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g))links.push(match[1]);
      for(let link of links) {
        if(/^(?:https?:|mailto:|#)/.test(link))continue;
        link=link.split('#')[0];if(!link)continue;
        const target=path.resolve(path.dirname(file),decodeURIComponent(link));
        assert.ok(target.startsWith(root+path.sep),`Documentation link escapes project: ${file}`);
        await access(target);
      }
    }
  }
  const ignored=['node_modules/example.js','dist/package.zip','reports/log.txt','test-results/page.png','.env','.env.local','credentials.json','service-account-demo.json','.DS_Store'];
  for(const file of ignored)assert.equal(git(['check-ignore','--no-index',file]).trim(),file,`Not ignored: ${file}`);
  const manifest=JSON.parse(await readFile('extension/manifest.json','utf8'));
  const pkg=JSON.parse(await readFile('package.json','utf8'));
  const lock=JSON.parse(await readFile('package-lock.json','utf8'));
  assert.equal(pkg.version,manifest.version);assert.equal(lock.version,pkg.version);assert.equal(pkg.license,'0BSD');assert.equal(lock.packages[''].engines.node,pkg.engines.node);
  assert.equal(await readFile('LICENSE','utf8'),await readFile('extension/LICENSE','utf8'));
  for(const forbidden of ['extension/lib/live-session.js','extension/lib/session-loop.js','extension/audio/pcm-recorder-processor.js','extension/audio/pcm-player-processor.js','tests/live-session.test.js','tests/session-loop.test.js','tests/messages.mjs'])assert.ok(!files.includes(forbidden),`Obsolete source: ${forbidden}`);
  console.log(`Publication checks passed: ${files.length} files, required documentation/screenshots, relative links, ignore rules, versions and credential patterns.`);
  console.log('This is a pattern-based check, not a guarantee that all possible secrets are detectable. No files were staged or published.');
} finally {if(temporary)await rm(temporary,{recursive:true,force:true});}
