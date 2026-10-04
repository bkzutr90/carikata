// Efek suara sintetis (Web Audio) -- tanpa file audio
window.SFX = (() => {
  let ctx = null, on = true, vol = 0.7;
  const ac = () => {
    if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; ctx = new C(); }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  };
  function tone(freq, delay, dur, type = 'sine', gain = 0.3) {
    const a = on && ac(); if (!a) return;
    const t = a.currentTime + delay, o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * vol), t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.05);
  }
  const seq = (notes, step, dur, type, gain) => notes.forEach((f, i) => tone(f, i * step, dur, type, gain));
  return {
    enable(v) { on = !!v; }, setVolume(v) { vol = Math.max(0, Math.min(1, v)); }, unlock() { ac(); },
    reveal() { seq([659.25, 880, 1108.73], 0.07, 0.3, 'triangle', 0.3); },                       // kata ketemu: "ting-ting-ting"
    gift() { seq([523.25, 659.25, 783.99, 1046.5, 1318.51], 0.06, 0.4, 'triangle', 0.32); tone(2093, 0.3, 0.5, 'sine', 0.12); }, // dibuka gift: lebih meriah
    done() { seq([523.25, 659.25, 783.99, 1046.5], 0.14, 0.5, 'square', 0.14); tone(1318.51, 0.56, 0.9, 'triangle', 0.3); },     // papan selesai
    tick() { tone(1400, 0, 0.07, 'square', 0.07); },                                              // sorot kotak (C7)
  };
})();
