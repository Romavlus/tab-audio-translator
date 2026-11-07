// SPDX-License-Identifier: 0BSD
// Exercises the actual offscreen host + new connection + new wire, without Google or a Chrome profile.
import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodePCM, decodePCM } from '../extension/lib/gemini-wire.js';
import { getFragments } from '../extension/lib/archive.js';
test('tab audio travels through the replacement host; pause, resume and stop release the right generation',async()=>{
 const sockets=[],nodes=[],contexts=[],announcements=[];let listener,trackStopped=false;
 const oldNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){trackStopped=true;}}]})}}});
 globalThis.chrome={runtime:{id:'fixture-extension',onMessage:{addListener:fn=>{listener=fn;}},sendMessage:async event=>{announcements.push(event);return {ok:true};}}};
 globalThis.WebSocket=class {
  constructor(){this.sent=[];sockets.push(this);}send(data){this.sent.push(JSON.parse(data));}close(){this.closed=true;}
 };
 const audioNode=()=>({connect(next){return next;},disconnect(){},gain:{value:0,setTargetAtTime(value){this.value=value;}}});
 globalThis.AudioContext=class {
  constructor(){this.currentTime=0;this.destination={};this.modules=[];this.audioWorklet={addModule:async name=>this.modules.push(name)};contexts.push(this);}
  createGain(){return audioNode();}createMediaStreamSource(){return audioNode();}async resume(){}async close(){this.closed=true;}
 };
 globalThis.AudioWorkletNode=class {
  constructor(_context,name){this.name=name;this.messages=[];this.port={postMessage:data=>this.messages.push(data),close:()=>{this.closed=true;}};nodes.push(this);}
  connect(next){return next;}disconnect(){}
 };
 const invoke=async(type,extra={})=>{
  const response=await new Promise(resolve=>listener({target:'engine',type,...extra},{id:'fixture-extension'},resolve));
  assert.equal(response.ok,true,response.error);return response.data;
 };
 const settle=async()=>{for(let n=0;n<12;n++)await Promise.resolve();};
 const deliver=async(socket,frame)=>{socket.onmessage({data:JSON.stringify(frame)});await settle();};
 try {
  await import('../extension/offscreen.js');
  const now=Date.now();await invoke('start',{streamId:'local-audio',tabId:12,session:{id:'replacement-integration',title:'Local test',url:'https://example.com',startedAt:now,updatedAt:now},settings:{apiKey:'local-key',model:'fixture-model',targetLanguage:'es',originalVolume:15,translationVolume:80,captions:true}});
  assert.equal(sockets.length,1);const socket=sockets[0];socket.onopen();await deliver(socket,{setupComplete:{}});
  assert.equal((await invoke('snapshot')).status,'connected');
  const input=nodes.find(node=>node.name==='tab-pcm-input'),output=nodes.find(node=>node.name==='tab-pcm-output');
  assert.ok(input&&output);assert.ok(contexts.some(ctx=>ctx.modules.includes('audio/tab-pcm-input.js')));
  input.port.onmessage({data:new Int16Array([27,-27]).buffer});
  assert.deepEqual([...new Int16Array(decodePCM(socket.sent.at(-1).realtimeInput.audio.data))],[27,-27]);
  await deliver(socket,{serverContent:{inputTranscription:{text:'Hello',finished:true},outputTranscription:{text:'Hola',finished:true},modelTurn:{parts:[{inlineData:{mimeType:'audio/pcm;rate=24000',data:encodePCM(new Int16Array([2048]).buffer)}}]},turnComplete:true}});
  assert.ok(output.messages.some(message=>message instanceof ArrayBuffer));
  await invoke('flush');const rows=await getFragments('replacement-integration');assert.ok(rows.some(row=>row.text==='Hola'));
  const staleHandler=socket.onmessage;await invoke('media',{action:'seeking'});assert.equal(socket.closed,true);assert.equal((await invoke('snapshot')).status,'paused');
  staleHandler({data:JSON.stringify({serverContent:{outputTranscription:{text:'stale',finished:true}}})});await settle();
  assert.notEqual((await invoke('snapshot')).latest,'stale');
  await invoke('media',{action:'play'});assert.equal(sockets.length,2);sockets[1].onopen();await deliver(sockets[1],{setupComplete:{}});
  await invoke('patch',{settings:{originalVolume:25,translationVolume:90,captions:false}});
  await invoke('stop');assert.equal(trackStopped,true);assert.ok(contexts.every(ctx=>ctx.closed));assert.ok(nodes.every(node=>node.closed));
  assert.equal((await invoke('snapshot')).running,false);assert.equal(sockets[1].closed,true);
 } finally {
  if(listener) await invoke('stop');
  if(oldNavigator)Object.defineProperty(globalThis,'navigator',oldNavigator);else delete globalThis.navigator;
  for(const name of ['chrome','WebSocket','AudioContext','AudioWorkletNode'])delete globalThis[name];
 }
});
