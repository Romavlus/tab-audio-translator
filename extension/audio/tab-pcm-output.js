// SPDX-License-Identifier: 0BSD
class TabAudioDecoder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = []; this.head = 0; this.offset = 0; this.remaining = 0; this.blocked = false;
    this.port.onmessage = event => this.accept(event.data);
  }
  accept(data) {
    if (data?.command === 'clear') { this.empty(); this.blocked = false; return; }
    if (this.blocked || !(data instanceof ArrayBuffer) || data.byteLength % 2) return;
    const count = data.byteLength / 2;
    if (this.remaining + count > 24000 * 30) {
      this.empty(); this.blocked = true; this.port.postMessage({type:'overflow'}); return;
    }
    if (count) { this.queue.push(new DataView(data)); this.remaining += count; }
  }
  empty() { this.queue = []; this.head = 0; this.offset = 0; this.remaining = 0; }
  process(_inlets, outlets) {
    const channels = outlets[0] || [];
    if (!channels.length) return true;
    const first = channels[0]; first.fill(0);
    let position = 0;
    while (position < first.length && this.remaining) {
      const packet = this.queue[this.head];
      const amount = Math.min(first.length - position, (packet.byteLength - this.offset) / 2);
      for (let n = 0; n < amount; n++) first[position + n] = packet.getInt16(this.offset + n * 2, true) / 32768;
      position += amount; this.offset += amount * 2; this.remaining -= amount;
      if (this.offset === packet.byteLength) { this.queue[this.head++] = null; this.offset = 0; }
    }
    for (let index = 1; index < channels.length; index++) channels[index].set(first);
    if (!this.remaining) this.empty();
    else if (this.head >= 32) { this.queue = this.queue.slice(this.head); this.head = 0; }
    return true;
  }
}
registerProcessor('tab-pcm-output', TabAudioDecoder);
