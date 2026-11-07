// SPDX-License-Identifier: 0BSD
import { mkdir, readdir, readFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
execFileSync(process.execPath,['scripts/check.mjs'],{stdio:'inherit'});
execFileSync(process.execPath,['scripts/check-publish.mjs'],{stdio:'inherit'});
const root=process.cwd(),manifest=JSON.parse(await readFile('extension/manifest.json','utf8'));
const version=manifest.version;await mkdir('dist',{recursive:true});
async function collect(directory) {
 const files=[];
 for(const entry of await readdir(directory,{withFileTypes:true})) {
  const file=path.join(directory,entry.name);
  if(entry.isDirectory())files.push(...await collect(file));else if(entry.isFile())files.push(file);
 }
 return files;
}
const extensionFiles=(await collect('extension')).map(file=>path.relative('extension',file)).sort();
assert.ok(extensionFiles.includes('manifest.json'));assert.ok(extensionFiles.includes('LICENSE'));
const extensionZip=path.resolve('dist',`tab-audio-translator-v${version}.zip`);
// Remove stale entries by creating a new archive in a temporary destination first.
const scratch=extensionZip+'.new.zip';
try {await access(scratch);throw new Error(`Unexpected stale temporary package: ${scratch}`);}catch(error){if(error.code!=='ENOENT')throw error;}
execFileSync('zip',['-q',scratch,...extensionFiles],{cwd:path.join(root,'extension')});
const {rename}=await import('node:fs/promises');await rename(scratch,extensionZip);
const sourceFiles=['.gitignore','README.md','README.ru.md','LICENSE','RELEASE_NOTES.md','RELEASE_NOTES.ru.md','package.json','package-lock.json'];
for(const directory of ['extension','tests','scripts','docs'])sourceFiles.push(...await collect(directory));
const sourceZip=path.resolve('dist',`tab-audio-translator-source-v${version}.zip`);
const scratchSource=sourceZip+'.new.zip';
try {await access(scratchSource);throw new Error(`Unexpected stale temporary package: ${scratchSource}`);}catch(error){if(error.code!=='ENOENT')throw error;}
execFileSync('zip',['-q',scratchSource,...sourceFiles.sort()],{cwd:root});await rename(scratchSource,sourceZip);
const entries=execFileSync('unzip',['-Z1',extensionZip],{encoding:'utf8'}).trim().split('\n');
assert.ok(entries.includes('manifest.json'));assert.ok(!entries.some(file=>file.startsWith('extension/')));
execFileSync('unzip',['-tq',extensionZip],{stdio:'inherit'});execFileSync('unzip',['-tq',sourceZip],{stdio:'inherit'});
console.log(`Created ${path.relative(root,extensionZip)} and ${path.relative(root,sourceZip)}.`);
