// Detect a Live response stuck in a generation loop across arbitrary chunks.
export class RepetitionGuard {
  constructor() { this.reset(); }
  reset() { this.text = ''; this.phrase = ''; }
  finish() {
    this.phrase = '';
    if (this.text && !/\s$/.test(this.text)) this.text += ' ';
  }
  push(text, finished = false) {
    if (typeof text !== 'string') return false;
    let delta = text;
    // Final transcriptions may contain the whole preceding phrase. They update
    // it rather than represent a second copy. Match Transcript's convention.
    if (finished) {
      if (this.phrase) delta = text.startsWith(this.phrase) ? text.slice(this.phrase.length) : '';
      this.phrase = '';
    } else this.phrase = (this.phrase + text).slice(-24000);
    this.text = (this.text + delta).slice(-24000);
    if (finished) this.finish();
    const words = (this.text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).slice(-900);
    // Require three consecutive copies of a long passage, with varied words.
    // Short refrains, stutters and repeated individual words remain audible.
    for (let period = 24; period <= Math.min(300, Math.floor(words.length / 3)); period++) {
      const start = words.length - period * 3;
      let same = true;
      for (let i = start + period; i < words.length; i++) {
        if (words[i] !== words[i - period]) { same = false; break; }
      }
      if (same) {
        const passage = words.slice(-period);
        if (new Set(passage).size >= 12 && passage.join(' ').length >= 120) return true;
      }
    }
    return false;
  }
}
