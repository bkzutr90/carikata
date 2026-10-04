// Antrian TTS: putar mp3 dari /api/tts, fallback ke speechSynthesis browser
window.TTS = (() => {
  const q = []; let busy = false, on = false, vol = 1, rate = 1, withNick = false;
  const MAX_Q = 6; // buang antrian lama kalau chat terlalu ramai
  const clean = t => String(t).replace(/\s+/g, ' ').trim();
  function speakFallback(text, done) {
    if (!('speechSynthesis' in window)) return done();
    const u = new SpeechSynthesisUtterance(text); u.lang = 'id-ID'; u.volume = vol; u.rate = rate;
    u.onend = u.onerror = done; speechSynthesis.speak(u);
  }
  function play(text, done) {
    const a = new Audio('/api/tts?text=' + encodeURIComponent(text));
    a.volume = vol; a.playbackRate = rate;
    let fin = false; const end = ok => { if (fin) return; fin = true; ok ? done() : speakFallback(text, done); };
    a.onended = () => end(true); a.onerror = () => end(false);
    a.play().catch(() => end(false));
  }
  function next() {
    if (busy || !on || !q.length) return;
    busy = true; play(q.shift(), () => { busy = false; next(); });
  }
  return {
    enable(v = true) { on = v; if (!v) { q.length = 0; speechSynthesis?.cancel?.(); } else next(); },
    setVolume(v) { vol = Math.max(0, Math.min(1, v)); }, setRate(r) { rate = r; }, readNick(v) { withNick = !!v; },
    say(nick, text) {
      if (!on) return; text = clean(text); if (!text) return;
      q.push((withNick ? `${nick} bilang, ${text}` : text).slice(0, 180));
      while (q.length > MAX_Q) q.shift();
      next();
    },
  };
})();
