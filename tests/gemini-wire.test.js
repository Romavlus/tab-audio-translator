// SPDX-License-Identifier: 0BSD
import test from 'node:test';
import assert from 'node:assert/strict';
import { GeminiWire, translationSetup, encodePCM, decodePCM, protocolFailure } from '../extension/lib/gemini-wire.js';
function fixture(options = {}) {
  const packets = [], closed = [], sent = [];
  const socket = { send: json => sent.push(JSON.parse(json)), close() { this.closed = true; } };
  const wire = new GeminiWire({ apiKey:'private+key', setup:translationSetup({model:'sample',targetLanguage:'es'}),
    socketFactory:url=>{socket.url=url;return socket;},onPacket:packet=>packets.push(packet),onDisconnect:error=>closed.push(error),...options });
  const deliver = async frame => { socket.onmessage({data:frame}); await wire.incoming; };
  const ready = async () => {const pending=wire.open();socket.onopen();await deliver(JSON.stringify({setupComplete:{}}));await pending;};
  return {wire,socket,packets,closed,sent,deliver,ready};
}
test('a connection requires the Gemini setup acknowledgement before uploading PCM',async()=>{
 const f=fixture();const opening=f.wire.open();f.socket.onopen();
 assert.equal(f.wire.send(new ArrayBuffer(4)),false);assert.equal(f.sent.length,1);
 assert.equal(f.sent[0].setup.generationConfig.translationConfig.targetLanguageCode,'es');
 assert.match(f.socket.url,/v1beta.*private%2Bkey$/);
 await f.deliver(JSON.stringify({setupComplete:{}}));await opening;
 assert.equal(f.wire.send(new Int16Array([42,-42]).buffer),true);
 assert.equal(f.sent[1].realtimeInput.audio.mimeType,'audio/pcm;rate=16000');
 assert.deepEqual([...new Int16Array(decodePCM(f.sent[1].realtimeInput.audio.data))],[42,-42]);f.wire.close();
});
test('a failed factory releases the handshake and its deadline',async()=>{
 const f=fixture({socketFactory:()=>{throw new Error('offline');}});
 await assert.rejects(f.wire.open(),/offline/);assert.equal(f.wire.phase,'closed');
});
test('a handshake timeout rejects instead of leaving an unresolved start',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture({timeoutMs:100});
 const result=assert.rejects(f.wire.open(),/timed out/);t.mock.timers.tick(100);await result;
 assert.equal(f.socket.closed,true);
});
test('cancel during setup rejects once and never reports a remote disconnect',async()=>{
 const f=fixture();const result=assert.rejects(f.wire.open(),/cancelled/);f.wire.close();f.wire.close();await result;
 assert.equal(f.closed.length,0);assert.equal(f.wire.apiKey,'');
});
test('JSON strings, UTF8 ArrayBuffers and Blobs keep their arrival order',async()=>{
 const f=fixture();await f.ready();
 const frames=[new Blob([JSON.stringify({serverContent:{inputTranscription:{text:'one'}}})]),new TextEncoder().encode(JSON.stringify({serverContent:{outputTranscription:{text:'two'}}})).buffer,JSON.stringify({serverContent:{outputTranscription:{text:'three',finished:true}}})];
 for(const data of frames)f.socket.onmessage({data});await f.wire.incoming;
 assert.deepEqual(f.packets.map(p=>p.text),['one','two','three']);assert.equal(f.packets.at(-1).finished,true);f.wire.close();
});
test('speech, PCM, usage, interruption and goAway are routed without treating text as executable',async()=>{
 const f=fixture();await f.ready();
 await f.deliver(JSON.stringify({usageMetadata:{totalTokenCount:8},goAway:{timeLeft:'1.25s'},serverContent:{outputTranscription:{text:'<script>unsafe()</script>'},modelTurn:{parts:[{inlineData:{mimeType:'audio/pcm;rate=24000',data:encodePCM(new Int16Array([32767]).buffer)}}]},interrupted:true}}));
 assert.deepEqual(f.packets.map(p=>p.type),['usage','rotate','output','audio','interrupted','turnComplete']);
 assert.equal(f.packets[1].milliseconds,1250);assert.equal(f.packets[2].text,'<script>unsafe()</script>');
 assert.equal(new Int16Array(f.packets[3].buffer)[0],32767);f.wire.close();
});
test('asynchronously decoded frames cannot publish after close',async()=>{
 const f=fixture();await f.ready();let release;
 f.socket.onmessage({data:{text:()=>new Promise(resolve=>{release=resolve;})}});
 await Promise.resolve();f.wire.close();release(JSON.stringify({serverContent:{outputTranscription:{text:'stale'}}}));await f.wire.incoming;
 assert.equal(f.packets.length,0);
});
test('quota and access failures are permanent and never expose a credential',async()=>{
 const f=fixture();await f.ready();await f.deliver(JSON.stringify({error:{code:429,message:'quota exceeded: private+key'}}));
 assert.equal(f.closed.length,1);assert.equal(f.closed[0].category,'quota');assert.equal(f.closed[0].fatal,true);
 assert.equal(f.closed[0].message.includes('private+key'),false);
 assert.equal(protocolFailure({code:403,message:'denied'}).fatal,true);
 assert.equal(protocolFailure('Model was retired').category,'model');
 assert.equal(protocolFailure('peer disconnected').fatal,false);
});
test('malformed server input closes the socket and settles the handshake',async()=>{
 const f=fixture();const rejected=assert.rejects(f.wire.open());await f.deliver('{broken');await rejected;assert.equal(f.socket.closed,true);
});
test('binary encoding round-trips empty buffers and multi-chunk PCM',()=>{
 for(const size of [0,1,8193,64000]){const bytes=Uint8Array.from({length:size},(_,i)=>i%251);assert.deepEqual(new Uint8Array(decodePCM(encodePCM(bytes.buffer))),bytes);}
});

test('a slow network cannot accumulate an unlimited WebSocket upload backlog',async()=>{
 const f=fixture();await f.ready();f.socket.bufferedAmount=300000;
 assert.equal(f.wire.send(new ArrayBuffer(3200)),false);assert.equal(f.socket.closed,true);assert.equal(f.closed.length,1);
});
test('permanent failure categories survive sanitization across controller boundaries',()=>{
 const failure=protocolFailure({code:403,message:'denied'},'secret');
 assert.equal(protocolFailure(failure,'secret').category,'access');assert.equal(protocolFailure(failure,'secret').fatal,true);
});
