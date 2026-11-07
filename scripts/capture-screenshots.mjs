// SPDX-License-Identifier: 0BSD
// Capture the actual UI with example data. No Google requests or user Chrome profile.
import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('extension');
const browser = await chromium.launch({headless:true});
async function prepare(context, demo) {
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'translator.example') return route.abort();
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(root + path.sep)) return route.abort();
    const types = {'.js':'text/javascript','.css':'text/css','.png':'image/png','.html':'text/html'};
    try { await route.fulfill({body:await readFile(file),contentType:types[path.extname(file)] || 'application/octet-stream'}); }
    catch { await route.fulfill({status:404,body:'Not found'}); }
  });
  await context.addInitScript(demo => {
    window.demoSettings = {apiKey:'',hasKey:true,targetLanguage:demo.locale,languageMode:'manual',detectedLanguage:demo.locale,mode:'both',voiceVolume:80,translationVolume:80,originalVolume:15,captions:true};
    window.demoState = {running:false,status:'idle',latest:'',latestInput:''};
    window.chrome = {tabs:{query:async()=>[{id:1,title:demo.title,url:'https://example.com/demo'}]},runtime:{openOptionsPage(){},sendMessage:async message=>{
      if (message.type === 'save-settings') Object.assign(window.demoSettings, message.patch);
      if (message.type === 'start') window.demoState = {running:true,status:'connected',latest:demo.output,latestInput:demo.input,source:{title:demo.title}};
      if (message.type === 'stop') window.demoState = {running:false,status:'stopped',latest:'',latestInput:''};
      return {ok:true,data:message.type==='snapshot'?{state:window.demoState,settings:window.demoSettings}:message.type==='check-key'?demo.exampleMode:window.demoSettings};
    }}};
  }, demo);
}
async function capture(demo) {
 const media = demo.locale === 'en' ? 'docs' : 'docs/ru';
 
 await mkdir(`${media}/screenshots`, {recursive:true});

  const context = await browser.newContext({viewport:{width:380,height:680}});
  await prepare(context, demo);
  const page = await context.newPage();
  const errors=[]; page.on('pageerror', error=>errors.push(error.message));
  await page.goto('http://translator.example/popup.html');
  await page.locator('#toggle').filter({hasText:demo.start}).waitFor();
  await page.locator('body').screenshot({path:`${media}/screenshots/main.png`});
  await page.locator('#settings').click();
  await page.locator('.key-guide summary').waitFor();
  await page.locator('body').screenshot({path:`${media}/screenshots/settings.png`});
  await page.locator('#back').click();
  await page.locator('#all-languages').click();
  await page.locator('#language-search').fill(demo.search);
  await page.locator(`[data-language=${demo.searchCode}]`).waitFor();
  await page.locator('body').screenshot({path:`${media}/screenshots/languages.png`});
  await page.locator('#languages-back').click();
  await page.locator('#all-languages').click();
  await page.locator('#language-search').fill(demo.targetSearch);
  await page.locator(`[data-language=${demo.locale}]`).click();
  await page.locator('[data-mode=both]').click();
  await page.locator('#toggle').click();
  await page.locator('#latest-card').waitFor({state:'visible'});
  await page.locator('body').screenshot({path:`${media}/screenshots/translating.png`});
  await page.locator('#latest-card summary').click();
  await page.locator('#toggle').click();
  await page.locator('#settings').click();
  await page.locator('.key-guide summary').click();
  await page.locator('#back').click();
  await context.close();
  const archiveContext = await browser.newContext({viewport:{width:1180,height:800}});
  await prepare(archiveContext, demo);
  const archive = await archiveContext.newPage();
  await archive.goto('http://translator.example/options.html');
  await archive.locator('#refresh-archive').filter({hasText:demo.refresh}).waitFor();
  await archive.evaluate(async demo=>{
    const db=await import('/lib/archive.js'); const at=Date.now();
    await db.createSession({id:'example',title:demo.title,url:'https://example.com/demo',startedAt:at-90000,updatedAt:at,endedAt:at,status:'stopped'});
    await db.saveFragments([
      {id:'example-in',sessionId:'example',kind:'input',text:demo.input,createdAt:at,updatedAt:at,offsetMs:12000},
      {id:'example-out',sessionId:'example',kind:'output',text:demo.output,createdAt:at,updatedAt:at,offsetMs:12000},
    ]);
  }, demo);
  await archive.locator('#refresh-archive').click();
  await archive.locator('#session-title').filter({hasText:demo.title}).waitFor();
  await archive.screenshot({path:`${media}/screenshots/history.png`});
  await archiveContext.close();
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('Captured screenshots with example text. No real API key, audio or user history used.');
}
const examples = [
 {locale:'en',title:'Video: how languages work',output:'Every new language opens another perspective.',input:'Chaque nouvelle langue ouvre une autre perspective.',exampleMode:'Example mode',start:'Start translation',refresh:'Refresh',search:'span',searchCode:'es',targetSearch:'engl'},
 {locale:'ru',title:'Видео: как работают языки',output:'Любой новый язык открывает другой взгляд на мир.',input:'Every new language opens another perspective.',exampleMode:'Демонстрационный режим',start:'Начать перевод',refresh:'Обновить',search:'англий',searchCode:'en',targetSearch:'рус'},
];
try { for (const demo of examples) await capture(demo); }
finally { await browser.close(); }
