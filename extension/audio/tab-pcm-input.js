// SPDX-License-Identifier: 0BSD
class TabAudioEncoder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.packet = new ArrayBuffer(3200);
    this.writer = new DataView(this.packet);
    this.byteOffset = 0;
  }
  process(inlets) {
    const mono = inlets[0]?.[0];
    if (!mono) return true;
    for (const sample of mono) {
      const bounded = Number.isFinite(sample) ? Math.min(1, Math.max(-1, sample)) : 0;
      const integer = Math.trunc(bounded * (bounded >= 0 ? 32767 : 32768));
      this.writer.setInt16(this.byteOffset, integer, true);
      this.byteOffset += 2;
      if (this.byteOffset === 3200) {
        const completed = this.packet;
        this.packet = new ArrayBuffer(3200); this.writer = new DataView(this.packet); this.byteOffset = 0;
        this.port.postMessage(completed, [completed]);
      }
    }
    return true;
  }
}
registerProcessor('tab-pcm-input', TabAudioEncoder);
