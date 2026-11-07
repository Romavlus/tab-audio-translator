// SPDX-License-Identifier: 0BSD
import test from 'node:test';
import assert from 'node:assert/strict';
import { TranslationConnection } from '../extension/lib/translation-connection.js';
function harness(t, overrides={}) {
 t.mock.timers.enable({apis:['setTimeout']});let at=0;const wires=[],events=[],statuses=[];
 const connection=new TranslationConnection({apiKey:'local-key',setup:{},now:()=>at,maxFailures:3,retryBaseMs:100,
  onEvent:event=>events.push(event),onStatus:(...args)=>statuses.push(args),makeWire:options=>{
   let accept,reject;const promise=new Promise((yes,no)=>{accept=yes;reject=no;});
   const wire={...options,sent:[],open:()=>promise,ready:()=>accept(wire),send:buffer=>{wire.sent.push(buffer.slice(0));return true;},close:()=>{wire.closed=true;reject(new Error('cancelled'));},fail:()=>reject(new Error('offline'))};
   wires.push(wire);return wire;
  },...overrides});
 const settle=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};
 const advance=async ms=>{at+=ms;t.mock.timers.tick(ms);await settle();};
 const start=async()=>{connection.start();wires[0].ready();await settle();};
 return {connection,wires,events,statuses,settle,advance,start};
}
test('opening, active and stopped generations have distinct ownership',async t=>{
 const h=harness(t);h.connection.start();h.connection.send(new Int16Array([7]).buffer);
 assert.equal(h.wires[0].sent.length,0);h.wires[0].ready();await h.settle();
 assert.deepEqual([...new Int16Array(h.wires[0].sent[0])],[7]);
 h.connection.close();h.wires[0].onPacket({type:'output',text:'old'});assert.equal(h.events.length,0);
 assert.equal(h.connection.apiKey,'');assert.equal(h.wires[0].closed,true);
});
test('stop cancels an outstanding handshake and scheduled reconnects',async t=>{
 const h=harness(t);h.connection.start();h.connection.close();await h.advance(100000);assert.equal(h.wires.length,1);
});
test('transient faults use backoff and stop at a bounded attempt count',async t=>{
 const h=harness(t);h.connection.start();h.wires[0].fail();await h.settle();
 await h.advance(99);assert.equal(h.wires.length,1);await h.advance(1);assert.equal(h.wires.length,2);
 h.wires[1].fail();await h.settle();await h.advance(199);assert.equal(h.wires.length,2);await h.advance(1);
 h.wires[2].fail();await h.settle();assert.equal(h.statuses.at(-1)[0],'failed');
 await h.advance(60000);assert.equal(h.wires.length,3);
});
test('a quota failure does not enter a retry cycle',async t=>{
 const h=harness(t);await h.start();h.wires[0].onDisconnect({fatal:true,category:'quota',message:'quota'});
 assert.equal(h.statuses.at(-1)[0],'failed');await h.advance(30000);assert.equal(h.wires.length,1);
});
test('rotation keeps the old socket until a sentence boundary and transfers unacknowledged audio',async t=>{
 const h=harness(t);await h.start();h.connection.send(new Int16Array([1]).buffer);
 h.wires[0].onPacket({type:'rotate',milliseconds:5000});h.wires[1].ready();await h.settle();
 assert.equal(h.wires[0].closed,undefined);h.wires[1].onPacket({type:'output',text:'not active'});assert.equal(h.events.length,0);
 h.wires[0].onPacket({type:'turnComplete'});assert.equal(h.wires[0].closed,true);
 h.connection.send(new Int16Array([2]).buffer);assert.deepEqual([...new Int16Array(h.wires[1].sent.at(-1))],[2]);
 h.wires[0].onPacket({type:'output',text:'stale'});assert.equal(h.events.some(e=>e.text==='stale'),false);h.connection.close();
});
test('the goAway deadline switches even if the speaker never pauses',async t=>{
 const h=harness(t);await h.start();h.connection.send(new Int16Array([3]).buffer);
 h.wires[0].onPacket({type:'rotate',milliseconds:4000});h.wires[1].ready();await h.settle();
 await h.advance(2999);assert.equal(h.wires[0].closed,undefined);await h.advance(1);assert.equal(h.wires[0].closed,true);
 assert.equal(h.wires[1].sent.length,1);h.connection.close();
});
test('an early close adopts the in-flight replacement without opening a third socket',async t=>{
 const h=harness(t);await h.start();h.wires[0].onPacket({type:'rotate',milliseconds:4000});
 h.wires[0].onDisconnect(new Error('closed'));h.wires[1].ready();await h.settle();
 assert.equal(h.wires.length,2);assert.equal(h.connection.primary,h.wires[1]);h.connection.close();
});
test('a failed replacement does not prematurely stop a healthy primary',async t=>{
 const h=harness(t);await h.start();h.wires[0].onPacket({type:'rotate',milliseconds:4000});h.wires[1].fail();await h.settle();
 assert.equal(h.connection.primary,h.wires[0]);await h.advance(3000);assert.equal(h.wires.length,3);h.connection.close();await h.settle();
});
test('recovery clears stale PCM, cancels warming sockets and limits recovery storms',async t=>{
 const h=harness(t);await h.start();h.connection.send(new ArrayBuffer(3200));h.wires[0].onPacket({type:'rotate',milliseconds:4000});
 h.connection.recover('backlog');assert.equal(h.wires[1].closed,true);assert.equal(h.connection.tailBytes,0);assert.equal(h.events.at(-1).type,'reset');
 h.wires[2].ready();await h.settle();assert.equal(h.wires[2].sent.length,0);
 h.connection.recover('backlog');h.connection.recover('backlog');h.connection.recover('backlog');await h.settle();
 assert.equal(h.statuses.at(-1)[0],'failed');
});
test('buffering stays bounded when no connection can upload',async t=>{
 const h=harness(t);h.connection.start();
 for(let i=0;i<1000;i++)h.connection.send(new ArrayBuffer(3200));assert.ok(h.connection.tailBytes<=320000);
 await h.advance(11000);h.connection.send(new ArrayBuffer(3200));assert.equal(h.connection.tailBytes,3200);h.connection.close();await h.settle();
});
test('long repeated output requests a reset rather than playing indefinitely',async t=>{
 const h=harness(t);await h.start();const sentence=Array.from({length:30},(_,i)=>`distinctword${i}`).join(' ')+' ';
 for(let i=0;i<3;i++)h.wires[0].onPacket({type:'output',text:sentence,finished:false});
 assert.equal(h.events.at(-1).type,'reset');assert.equal(h.events.at(-1).reason,'repetition');h.connection.close();await h.settle();
});

test('an opening handshake with a permanent access error stops immediately',async t=>{
 const h=harness(t,{makeWire:()=>({open:()=>Promise.reject(Object.assign(new Error('denied'),{category:'access',fatal:true})),close(){}})});
 h.connection.start();await h.settle();assert.equal(h.statuses.at(-1)[0],'failed');
});

test('genuinely repeated source speech is allowed to repeat in the translation',async t=>{
 const h=harness(t);await h.start();const words=Array.from({length:30},(_,i)=>`spokenword${i}`).join(' ')+' ';
 for(let i=0;i<3;i++){h.wires[0].onPacket({type:'input',text:words,finished:false});h.wires[0].onPacket({type:'output',text:words,finished:false});}
 assert.equal(h.events.some(event=>event.type==='reset'),false);h.connection.close();
});

test('a standby that dies before promotion cannot replace a healthy connection',async t=>{
 const h=harness(t);await h.start();h.connection.send(new ArrayBuffer(3200));
 h.wires[0].onPacket({type:'rotate',milliseconds:4000});h.wires[1].ready();await h.settle();
 h.wires[1].onDisconnect(new Error('standby lost'));assert.equal(h.connection.candidate,null);assert.equal(h.connection.primary,h.wires[0]);
 await h.advance(3000);assert.equal(h.wires.length,3);assert.equal(h.wires[0].closed,true);
 h.wires[2].ready();await h.settle();assert.equal(h.connection.primary,h.wires[2]);h.connection.close();
});
