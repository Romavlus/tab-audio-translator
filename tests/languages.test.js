import test from 'node:test';
import assert from 'node:assert/strict';
import { LANGUAGES, languageItems, languageLabel, PRIMARY_LANGUAGES, matchLanguage, detectLanguage, browserLanguage } from '../extension/lib/languages.js';
import { CATALOGS } from '../extension/lib/locales.js';
import { interfaceLocale } from '../extension/lib/locale.js';
import { normalizeSettings } from '../extension/lib/settings.js';
import { translationSetup } from '../extension/lib/gemini-wire.js';
test('Chrome regional language resolves to a supported Gemini target', () => {
 for (const [input,target] of [['en-US','en'],['es-MX','es'],['ru-RU','ru'],['zh-TW','zh-Hant'],['zh-CN','zh-Hans'],['pt-PT','pt-PT'],['pt-BR','pt-BR'],['iw-IL','he'],['ko-KR','ko']]) assert.equal(matchLanguage(input),target);
 assert.equal(detectLanguage(['xx-ZZ','en-GB','ru']),'en');
 assert.equal(detectLanguage(['unknown']),'en');
});
test('automatic language uses Chrome UI language first, accepted languages second',async()=>{
 globalThis.chrome={i18n:{getUILanguage:()=> 'en-US',getAcceptLanguages:async()=>['ru']}};
 assert.equal(await browserLanguage(),'en');
 globalThis.chrome.i18n.getUILanguage=()=> 'unknown';
 assert.equal(await browserLanguage(),'ru');
 delete globalThis.chrome;
});
test('all documented targets pass settings validation and reach the Gemini setup',()=>{
 assert.equal(new Set(LANGUAGES.map(item=>item.code)).size,79);
 for(const {code} of LANGUAGES){
  const settings=normalizeSettings({targetLanguage:code,languageMode:'manual'});
  assert.equal(settings.targetLanguage,code);
  assert.equal(settings.languageMode,'manual');
  assert.equal(translationSetup(settings).setup.generationConfig.translationConfig.targetLanguageCode,code);
 }
});
test('manual language survives update; automatic mode is explicit',()=>{
 assert.equal(normalizeSettings({targetLanguage:'es'}).languageMode,'manual');
 assert.equal(normalizeSettings({targetLanguage:'es',languageMode:'auto'}).languageMode,'auto');
 assert.equal(normalizeSettings({targetLanguage:'invalid'}).targetLanguage,'en');
});
test('12 interface catalogs are complete, with explicit English fallback',()=>{
 const keys=Object.keys(CATALOGS.en).sort();assert.equal(Object.keys(CATALOGS).length,12);
 for(const catalog of Object.values(CATALOGS)){
  assert.deepEqual(Object.keys(catalog).sort(),keys);
  for(const value of Object.values(catalog)) assert.equal(typeof value,'string');
 }
 assert.equal(interfaceLocale('es'),'es');assert.equal(interfaceLocale('pt-PT'),'pt');
 assert.equal(interfaceLocale('ar'),'en');assert.equal(interfaceLocale('zh-Hant'),'en');
});

test('language names have consistent capitalization and a single localized label',()=>{
 assert.equal(PRIMARY_LANGUAGES.length,12);
 for (const locale of Object.keys(CATALOGS)) {
  const items=languageItems(locale);assert.equal(items.length,78);
  for(const item of items) {
   const first=[...item.label][0];assert.equal(first,first.toLocaleUpperCase(locale));
   assert.equal(item.label.includes(' · '),false);
  }
 }
 assert.equal(languageLabel('es','es'),'Español');
 assert.equal(languageLabel('ru','ru'),'Русский');
 assert.equal(languageLabel('tr','tr'),'Türkçe');
});
