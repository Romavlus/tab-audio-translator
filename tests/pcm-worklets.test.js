// SPDX-License-Identifier: 0BSD
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
function createWorklet(file) {
 let Processor;const messages=[];
 vm.runInNewContext(readFileSync(new URL(`../extension/audio/${file}.js`,import.meta.url),'utf8'),{
  AudioWorkletProcessor:class {constructor(){this.port={postMessage:(data,transfer)=>messages.push({data,transfer})};}},
  ArrayBuffer,DataView,registerProcessor:(_,implementation)=>{Processor=implementation;},
 });
 return {processor:new Processor(),messages};
}
test('arbitrary input blocks produce contiguous 100ms little-endian PCM16 packets',()=>{
 const {processor,messages}=createWorklet('tab-pcm-input');
 const samples=Float32Array.from({length:6400},(_,i)=>[0,.5,-.5,1,-1,2,-2,NaN][i%8]);
 for(let offset=0;offset<samples.length;offset+=97)processor.process([[samples.slice(offset,offset+97)]]);
 assert.equal(messages.length,4);
 const actual=messages.flatMap(({data,transfer})=>{assert.equal(transfer[0],data);const view=new DataView(data);return Array.from({length:1600},(_,i)=>view.getInt16(i*2,true));});
 const expected=[...samples].map(sample=>Number.isFinite(sample)?Math.trunc(Math.max(-1,Math.min(1,sample))*(sample<0?32768:32767)):0);
 assert.deepEqual(actual,expected);
 processor.process([]);assert.equal(messages.length,4);
});
test('packet boundaries do not leak old output and all channels receive the same signal',()=>{
 const {processor}=createWorklet('tab-pcm-output');
 for(const values of [[1000,-2000],[3000]])processor.accept(new Int16Array(values).buffer);
 const channels=[new Float32Array(5),new Float32Array(5)];processor.process([],[channels]);
 assert.deepEqual([...channels[0]],[1000/32768,-2000/32768,3000/32768,0,0]);assert.deepEqual(channels[0],channels[1]);
 channels[0].fill(1);processor.process([],[channels]);assert.deepEqual([...channels[0]],[0,0,0,0,0]);
 assert.equal(processor.queue.length,0);
});
test('overflow is signaled once, blocks stale audio, and clear restores playback',()=>{
 const {processor,messages}=createWorklet('tab-pcm-output');processor.accept(new ArrayBuffer(24000*30*2));processor.accept(new Int16Array([9]).buffer);
 assert.equal(messages.length,1);assert.equal(messages[0].data.type,'overflow');assert.equal(processor.remaining,0);
 processor.accept(new Int16Array([123]).buffer);assert.equal(processor.remaining,0);
 processor.accept({command:'clear'});processor.accept(new Int16Array([16384]).buffer);
 const channel=new Float32Array(1);processor.process([],[[channel]]);assert.equal(channel[0],.5);
});
test('clearing a partially consumed packet discards the remainder',()=>{
 const {processor}=createWorklet('tab-pcm-output');processor.accept(new Int16Array([1,2,3]).buffer);
 processor.process([],[[new Float32Array(1)]]);processor.accept({command:'clear'});
 const output=new Float32Array(3);processor.process([],[[output]]);assert.deepEqual([...output],[0,0,0]);
});
test('many short packets are released as playback advances, with no permanent queue growth',()=>{
 const {processor}=createWorklet('tab-pcm-output');
 for(let tick=0;tick<10000;tick++){processor.accept(new Int16Array([tick%30000]).buffer);processor.process([],[[new Float32Array(1)]]);assert.equal(processor.queue.length,0);}
});
