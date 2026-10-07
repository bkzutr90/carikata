require('dotenv').config();
const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const { TikTokLiveConnection, WebcastEvent } = require('tiktok-live-connector');
const { Game, MODES } = require('./lib/game');
const { loadWords, LEVELS, DEFAULT_LEVEL } = require('./lib/words');

const PORT = process.env.PORT || 3000;
const DEBUG = !!process.env.DEBUG_TIKTOK;
const ROUND_DELAY = Math.max(1, +process.env.ROUND_DELAY_S || 10); // detik jeda sebelum ronde baru
const END_SECONDS = Math.max(1, +process.env.END_SECONDS || 10);   // detik countdown End Live
const HINT_MS = Math.max(5, +process.env.HINT_SECONDS || 15) * 1000; // hint otomatis kalau tidak ada yang menjawab
const AUTO_EVERY = Math.max(1, +process.env.AUTO_EVERY || 5);      // Mode otomatis: ganti mode tiap N ronde
const SPIN_S = Math.max(3, +process.env.SPIN_SECONDS || 6);        // lama animasi spin (detik)
const app = express();
app.use(cors(), express.json(), express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const game = new Game();
let level = DEFAULT_LEVEL, conn = null, status = { state: 'idle', username: '', viewers: 0, likes: 0 }, wantUser = '', retry;

// End Live / Skor Akhir: frozen = skor dibekukan; podium = data podium yang sedang tampil
let frozen = false, endTimer = null, podium = null;
let scoreShown = false; // sudah menekan "Skor Akhir"? (syarat untuk ganti mode)
const avatars = new Map(); // id/nick -> url foto (cadangan kalau game.scores tidak menyimpan avatar)

// Mode otomatis: tiap AUTO_EVERY ronde selesai -> spin acak untuk ganti mode papan
let autoMode = false, autoRounds = 0, spinning = false;
const autoInfo = () => ({ on: autoMode, every: AUTO_EVERY, count: autoRounds });
const broadcastAuto = () => broadcast('auto', autoInfo());

// Hint otomatis: tiap HINT_MS tanpa ada kata ketemu -> kirim hint. Timer di-reset oleh sendState().
let hintTimer = null;
function armHint() {
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => {
    if (!frozen && !game.done) { const h = game.hint(); if (h) broadcast('hint', h); }
    armHint(); // kalau masih belum ada yang jawab, hint berikutnya HINT_MS lagi
  }, HINT_MS);
}

// Statistik live untuk overlay chat (/chat.html)
// viewers = penonton saat ini; totalViewers = unik yang terlihat sejak server konek (atau puncak viewers, mana yang lebih besar)
const stats = { viewers: 0, totalViewers: 0, diamonds: 0, giftCount: 0, follows: 0, likes: 0 };
const seen = new Set();
let peakViewers = 0, statsTimer = null;

const send = (ws, type, data) => ws.readyState === 1 && ws.send(JSON.stringify({ type, data }));
const broadcast = (type, data) => wss.clients.forEach(ws => send(ws, type, data));
const setStatus = p => { Object.assign(status, p); broadcast('status', status); };

// kirim stats ke widget; ditahan 300ms supaya event like yang rapat tidak membanjiri
const pushStats = now => {
  if (now) { clearTimeout(statsTimer); statsTimer = null; return broadcast('stats', stats); }
  if (statsTimer) return;
  statsTimer = setTimeout(() => { statsTimer = null; broadcast('stats', stats); }, 300);
};
const markSeen = u => { if (!u?.id) return; seen.add(String(u.id)); stats.totalViewers = Math.max(seen.size, peakViewers); };
function resetStats() {
  Object.assign(stats, { viewers: 0, totalViewers: 0, diamonds: 0, giftCount: 0, follows: 0, likes: 0 });
  seen.clear(); peakViewers = 0; pushStats(true);
}

// Kunci jawaban ronde berjalan: hanya dikirim ke widget /answers.html
// Kalau ANSWERS_KEY diisi, widget harus membuka /answers.html?key=ISI_KEY
const ANSWERS_KEY = process.env.ANSWERS_KEY || '';
// arah kata dihitung dari dua sel pertama: key "dBaris,dKolom" -> panah (8 arah)
const ARROW = { '0,1': '→', '1,0': '↓', '1,1': '↘', '1,-1': '↙', '0,-1': '←', '-1,0': '↑', '-1,-1': '↖', '-1,1': '↗' };
function answersData() {
  const words = game.words.map(w => {
    const [r, c] = w.cells[0];
    const [r2, c2] = w.cells[1] || [r, c + 1];
    const dir = ARROW[`${Math.sign(r2 - r)},${Math.sign(c2 - c)}`] || '→';
    return { word: w.word, r, c, pos: String.fromCharCode(65 + r) + (c + 1), dir, found: !!w.found, by: w.found?.nick || '' };
  }).sort((a, b) => a.r - b.r || a.c - b.c);
  return { round: game.round, words };
}
// kirim state papan ke semua widget + jawaban ke widget yang berhak; juga reset timer hint
function sendState() {
  broadcast('state', game.state());
  const a = answersData();
  wss.clients.forEach(ws => ws.canSeeAnswers && send(ws, 'answers', a));
  armHint();
}

wss.on('connection', (ws, req) => {
  let key = ''; try { key = new URL(req.url, 'http://x').searchParams.get('key') || ''; } catch {}
  ws.canSeeAnswers = !ANSWERS_KEY || key === ANSWERS_KEY;
  send(ws, 'level', level); send(ws, 'mode', game.mode); send(ws, 'auto', autoInfo()); send(ws, 'state', game.state()); send(ws, 'status', status); send(ws, 'stats', stats);
  if (ws.canSeeAnswers) send(ws, 'answers', answersData());
  if (podium) send(ws, 'podium', podium); // widget OBS yang di-refresh tetap menampilkan podium
});

// Normalisasi data user (kompatibel dgn payload v2 dan bentuk lama)
const getUser = d => {
  const u = d.user || d;
  return {
    id: String(u.userId || u.uniqueId || u.displayId || u.nickname),
    nick: u.nickname || u.uniqueId || u.displayId || 'anon',
    avatar:
      u.avatarThumb?.urlList?.[0] ||
      u.profilePicture?.urls?.[0] ||
      u.profilePicture?.url?.[0] ||
      u.profilePictureUrl ||
      '',
  };
};

const remember = u => { if (u?.avatar) { avatars.set(String(u.id), u.avatar); avatars.set(String(u.nick), u.avatar); } };

// Top pemain dari game.scores (toleran terhadap bentuk datanya: angka, atau objek {nick, avatar, points})
function topPlayers(n = 10) {
  const sc = game.scores;
  const list = sc instanceof Map ? [...sc.entries()] : Object.entries(sc || {});
  return list.map(([k, v]) => {
    const o = v && typeof v === 'object' ? v : { points: +v || 0 };
    const u = o.user || o;
    const nick = u.nick || o.nick || String(k);
    return {
      id: String(k),
      nick,
      avatar: u.avatar || o.avatar || avatars.get(String(k)) || avatars.get(nick) || '',
      points: o.points ?? o.score ?? o.pts ?? 0,
    };
  }).sort((a, b) => b.points - a.points).slice(0, n);
}

function startEnd(sec) {
  clearTimeout(endTimer); podium = null; frozen = true;
  broadcast('endlive', { seconds: sec });
  endTimer = setTimeout(() => {
    endTimer = null;
    podium = { players: topPlayers(10) };
    broadcast('podium', podium);
  }, sec * 1000);
}
function cancelEnd() {
  clearTimeout(endTimer); endTimer = null; frozen = false; podium = null; scoreShown = false;
  broadcast('endlive_cancel', {}); armHint();
}

// Mode otomatis: spin acak (hasil selalu beda dari mode sekarang), tampil di layar, lalu ganti mode + ronde baru
function startSpin() {
  if (spinning) return;
  const others = MODES.filter(m => m !== game.mode);
  const result = others[Math.floor(Math.random() * others.length)];
  spinning = true; autoRounds = 0; broadcastAuto();
  broadcast('spin', { result, seconds: SPIN_S, from: game.mode });
  setTimeout(() => {
    game.setMode(result);
    spinning = false;
    broadcast('mode', result);
    game.newRound(); sendState();
  }, SPIN_S * 1000);
}

// Setelah ada kata ketemu (dari chat atau gift): kirim ke semua widget, mulai ronde baru kalau papan selesai
function announceFound(entry) {
  sendState();
  broadcast('found', { word: entry.word, user: entry.found, via: entry.found.via });
  if (game.done) {
    let willSpin = false;
    if (autoMode) { autoRounds++; willSpin = autoRounds >= AUTO_EVERY; broadcastAuto(); }
    broadcast('done', { seconds: ROUND_DELAY, players: topPlayers(10), spin: willSpin });
    setTimeout(() => {
      if (frozen) return;
      if (autoMode && autoRounds >= AUTO_EVERY) return startSpin();
      game.newRound(); sendState();
    }, ROUND_DELAY * 1000);
  }
}

function handleChat(user, text) {
  remember(user);
  broadcast('chat', { user, text });
  if (frozen || spinning) return; // End Live / Skor Akhir / sedang spin: jawaban tidak dihitung
  const res = game.guess(user, text);
  if (!res) return;
  if (res.type === 'cell') return broadcast('cell', { r: res.r, c: res.c });
  announceFound(res.entry);
}

// Gift: poin = diamond, dan pemberi gift otomatis membuka kata di papan (tanpa mengetik)
const GIFT_MAX_WORDS = Math.max(1, +process.env.GIFT_MAX_WORDS || 1);
function handleGift(user, giftName, diamonds, count) {
  remember(user);
  stats.giftCount += count; stats.diamonds += diamonds * count; pushStats();
  if (frozen) return broadcast('gift', { user, gift: giftName, count }); // dibekukan: tidak menambah poin
  game.addScore(user, diamonds * count);
  broadcast('gift', { user, gift: giftName, count });
  let opened = 0;
  for (let i = 0; i < Math.min(count, GIFT_MAX_WORDS) && !game.done; i++) {
    const entry = game.reveal(user);
    if (!entry) break;
    opened++; announceFound(entry);
  }
  if (!opened) sendState();
}

function disconnect() { clearTimeout(retry); wantUser = ''; try { conn?.disconnect(); } catch {} conn = null; setStatus({ state: 'idle' }); }

async function connect(username, isRetry = false) {
  username = String(username || '').replace(/^@/, '').trim();
  if (!username) return;
  try { conn?.removeAllListeners(); conn?.disconnect(); } catch {}
  clearTimeout(retry); wantUser = username;
  if (!isRetry) resetStats(); // sambung ulang otomatis tidak mereset statistik
  setStatus({ state: 'connecting', username, error: '' });

  // Selalu kirim objek options eksplisit.
  // SIGN_API_KEY: API key gratis dari eulerstream.com (tanpa ini kena rate-limit sign server).
  // SESSION_ID: cookie "sessionid" akun TikTok yang login (opsional tapi disarankan).
  conn = new TikTokLiveConnection(username, {
    processInitialData: false,
    signApiKey: process.env.SIGN_API_KEY || undefined,
    sessionId: process.env.SESSION_ID || undefined,
  });

  conn.on(WebcastEvent.CHAT, d => {
    if (DEBUG) console.log('[DEBUG chat]', JSON.stringify(d));
    const u = getUser(d);
    markSeen(u); pushStats();
    handleChat(u, d.comment ?? d.content ?? '');
  });
  conn.on(WebcastEvent.GIFT, d => {
    if (DEBUG) console.log('[DEBUG gift]', JSON.stringify(d));
    const type = d.giftType ?? d.giftDetails?.giftType;
    if (type === 1 && !d.repeatEnd) return; // gift beruntun: tunggu streak selesai
    const u = getUser(d);
    markSeen(u);
    handleGift(u, d.giftName || d.giftDetails?.giftName || 'gift',
      d.diamondCount ?? d.giftDetails?.diamondCount ?? 1, d.repeatCount || 1);
  });
  conn.on(WebcastEvent.LIKE, d => {
    markSeen(getUser(d));
    stats.likes = d.totalLikeCount ?? (stats.likes + (d.likeCount || 1));
    setStatus({ likes: stats.likes }); pushStats();
  });
  conn.on(WebcastEvent.MEMBER, d => { markSeen(getUser(d)); pushStats(); });
  conn.on(WebcastEvent.FOLLOW, d => { markSeen(getUser(d)); stats.follows += 1; pushStats(); });
  conn.on(WebcastEvent.ROOM_USER, d => {
    const v = d.viewerCount ?? 0;
    stats.viewers = v; peakViewers = Math.max(peakViewers, v);
    stats.totalViewers = Math.max(seen.size, peakViewers);
    setStatus({ viewers: v }); pushStats();
  });
  conn.on(WebcastEvent.STREAM_END, () => setStatus({ state: 'ended' }));
  conn.on('disconnected', () => { if (wantUser) { setStatus({ state: 'reconnecting' }); retry = setTimeout(() => connect(wantUser, true), 5000); } });
  conn.on('error', e => console.error('[tiktok]', e?.info || e?.message || e));

  try {
    const st = await conn.connect();
    console.log('[connected] roomId:', st?.roomId);
    setStatus({ state: 'connected' });
  } catch (e) {
    console.error('[connect]', e?.message || e);
    setStatus({ state: 'error', error: String(e?.message || e) });
    wantUser = '';
  }
}


// Text-to-speech: proxy ke Google Translate TTS (mp3), dengan cache kecil
const ttsCache = new Map();
app.get('/api/tts', async (req, res) => {
  const text = String(req.query.text || '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ').replace(/https?:\/\/\S+/g, 'tautan').replace(/\s+/g, ' ').trim().slice(0, 180);
  if (!text) return res.status(400).end();
  try {
    let buf = ttsCache.get(text);
    if (!buf) {
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${process.env.TTS_LANG || 'id'}&q=${encodeURIComponent(text)}`;
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://translate.google.com/' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      buf = Buffer.from(await r.arrayBuffer());
      ttsCache.set(text, buf);
      if (ttsCache.size > 200) ttsCache.delete(ttsCache.keys().next().value);
    }
    res.set({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=3600' }).send(buf);
  } catch (e) { console.error('[tts]', e.message); res.status(502).end(); }
});

app.post('/api/difficulty', async (req, res) => {
  const l = req.body.level; if (!LEVELS[l]) return res.status(400).json({ ok: false });
  level = l; game.setWords(await loadWords(l)); game.newRound();
  broadcast('level', level); sendState(); res.json({ ok: true, level });
});
app.get('/api/difficulty', (_, res) => res.json({ level }));
app.post('/api/connect', (req, res) => { connect(req.body.username); res.json({ ok: true }); });
app.post('/api/disconnect', (_, res) => { disconnect(); res.json({ ok: true }); });
app.post('/api/new-round', (_, res) => {
  if (spinning) return res.json({ ok: true }); // sedang spin: ronde baru dibuat otomatis setelah spin
  if (frozen) cancelEnd(); game.newRound(); sendState(); res.json({ ok: true });
});
app.post('/api/reset-scores', (_, res) => { game.scores.clear(); sendState(); res.json({ ok: true }); });
app.post('/api/reset-stats', (_, res) => { resetStats(); res.json({ ok: true }); });

// Mode otomatis: aktif/mati. Penghitung ronde mulai dari 0 setiap kali diubah.
app.post('/api/auto', (req, res) => {
  autoMode = !!req.body?.on; autoRounds = 0; broadcastAuto();
  res.json({ ok: true, ...autoInfo() });
});
app.get('/api/auto', (_, res) => res.json(autoInfo()));

// End Live: countdown N detik, lalu tampilkan podium top 10
app.post('/api/end-live', (req, res) => {
  const sec = Math.min(60, Math.max(1, Math.round(+req.body?.seconds || END_SECONDS)));
  startEnd(sec); res.json({ ok: true, seconds: sec });
});
app.post('/api/end-live/cancel', (_, res) => { cancelEnd(); res.json({ ok: true }); });

// Skor Akhir: tampilkan podium langsung (tanpa countdown), skor dibekukan. BEDA dari End Live.
app.post('/api/final-score', (_, res) => {
  clearTimeout(endTimer); endTimer = null;
  frozen = true; scoreShown = true;
  podium = { players: topPlayers(10), kind: 'score' };
  broadcast('podium', podium); res.json({ ok: true });
});

// Ganti mode papan: kalau sudah ada skor, wajib tekan "Skor Akhir" dulu. Ganti mode = skor di-reset.
app.post('/api/mode', (req, res) => {
  const m = req.body.mode;
  if (!MODES.includes(m)) return res.status(400).json({ ok: false, error: 'Mode tidak dikenal' });
  if (spinning) return res.status(409).json({ ok: false, error: 'Sedang spin mode otomatis, tunggu sebentar.' });
  if (m === game.mode) return res.json({ ok: true, mode: m });
  const hasScores = [...game.scores.values()].some(v => (v.points || 0) > 0);
  if (hasScores && !scoreShown)
    return res.status(409).json({ ok: false, error: 'Tekan "Skor Akhir" dulu sebelum ganti mode.' });
  game.setMode(m); game.scores.clear();
  clearTimeout(endTimer); endTimer = null; frozen = false; podium = null; scoreShown = false;
  autoRounds = 0; broadcastAuto();
  broadcast('endlive_cancel', {}); broadcast('mode', m);
  game.newRound(); sendState(); res.json({ ok: true, mode: m });
});
app.get('/api/mode', (_, res) => res.json({ mode: game.mode }));

// Simulasi chat untuk testing tanpa live
app.post('/api/sim', (req, res) => {
  const { nick = 'tester', text = '' } = req.body;
  handleChat({ id: nick, nick, avatar: '' }, text); res.json({ ok: true });
});
app.post('/api/sim-gift', (req, res) => {
  const { nick = 'tester', gift = 'Rose', diamonds = 1, count = 1 } = req.body;
  handleGift({ id: nick, nick, avatar: '' }, gift, +diamonds, +count); res.json({ ok: true });
});
app.get('/api/answers', (_, res) => res.json(game.words.map(w => w.word))); // bantu moderator/testing

(async () => {
  game.setWords(await loadWords(level));
  game.round = 0; game.newRound(); armHint();
  server.listen(PORT, () => {
    console.log(`Dashboard   : http://localhost:${PORT}\nGame (OBS)  : http://localhost:${PORT}/?overlay=1\nLeaderboard : http://localhost:${PORT}/leaderboard.html\nChat (OBS)  : http://localhost:${PORT}/chat.html\nSuara (OBS) : http://localhost:${PORT}/tts.html`);
    if (process.env.TIKTOK_USERNAME) connect(process.env.TIKTOK_USERNAME);
  });
})();
