require('dotenv').config();
const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const { TikTokLiveConnection, WebcastEvent } = require('tiktok-live-connector');
const { Game } = require('./lib/game');
const { loadWords } = require('./lib/words');

const PORT = process.env.PORT || 3000;
const app = express();
app.use(cors(), express.json(), express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const game = new Game();
let conn = null, status = { state: 'idle', username: '', viewers: 0, likes: 0 }, wantUser = '', retry;

const send = (ws, type, data) => ws.readyState === 1 && ws.send(JSON.stringify({ type, data }));
const broadcast = (type, data) => wss.clients.forEach(ws => send(ws, type, data));
const setStatus = p => { Object.assign(status, p); broadcast('status', status); };
wss.on('connection', ws => { send(ws, 'state', game.state()); send(ws, 'status', status); });

// Normalisasi data user (kompatibel dgn berbagai bentuk payload)
const getUser = d => {
  const u = d.user || d;
  return {
    id: String(u.userId || u.uniqueId || u.nickname),
    nick: u.nickname || u.uniqueId || 'anon',
    avatar: u.profilePicture?.url?.[0] || u.profilePictureUrl || '',
  };
};

function handleChat(user, text) {
  broadcast('chat', { user, text });
  const res = game.guess(user, text);
  if (!res) return;
  if (res.type === 'cell') return broadcast('cell', { r: res.r, c: res.c });
  broadcast('state', game.state());
  broadcast('found', { word: res.entry.word, user: res.entry.found });
  if (game.done) { broadcast('done', {}); setTimeout(() => { game.newRound(); broadcast('state', game.state()); }, 10000); }
}

function disconnect() { clearTimeout(retry); wantUser = ''; try { conn?.disconnect(); } catch {} conn = null; setStatus({ state: 'idle' }); }

async function connect(username) {
  username = String(username || '').replace(/^@/, '').trim();
  if (!username) return;
  try { conn?.disconnect(); } catch {}
  clearTimeout(retry); wantUser = username;
  setStatus({ state: 'connecting', username, error: '' });
  conn = new TikTokLiveConnection(username, { sessionId: process.env.SESSION_ID || undefined });

  conn.on(WebcastEvent.CHAT, d => handleChat(getUser(d), d.comment || ''));
  conn.on(WebcastEvent.GIFT, d => {
    if (d.giftType === 1 && !d.repeatEnd) return; // tunggu streak selesai
    const user = getUser(d), pts = (d.diamondCount || 1) * (d.repeatCount || 1);
    game.addScore(user, pts);
    broadcast('gift', { user, gift: d.giftName || d.giftDetails?.giftName, count: d.repeatCount || 1 });
    broadcast('state', game.state());
  });
  conn.on(WebcastEvent.LIKE, d => setStatus({ likes: d.totalLikeCount ?? status.likes }));
  conn.on(WebcastEvent.ROOM_USER, d => setStatus({ viewers: d.viewerCount ?? 0 }));
  conn.on(WebcastEvent.STREAM_END, () => setStatus({ state: 'ended' }));
  conn.on('disconnected', () => { if (wantUser) { setStatus({ state: 'reconnecting' }); retry = setTimeout(() => connect(wantUser), 5000); } });
  conn.on('error', e => console.error('[tiktok]', e?.message || e));

  try { await conn.connect(); setStatus({ state: 'connected' }); }
  catch (e) { console.error('[connect]', e?.message || e); setStatus({ state: 'error', error: String(e?.message || e) }); wantUser = ''; }
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

app.post('/api/connect', (req, res) => { connect(req.body.username); res.json({ ok: true }); });
app.post('/api/disconnect', (_, res) => { disconnect(); res.json({ ok: true }); });
app.post('/api/new-round', (_, res) => { game.newRound(); broadcast('state', game.state()); res.json({ ok: true }); });
app.post('/api/reset-scores', (_, res) => { game.scores.clear(); broadcast('state', game.state()); res.json({ ok: true }); });
// Simulasi chat untuk testing tanpa live
app.post('/api/sim', (req, res) => {
  const { nick = 'tester', text = '' } = req.body;
  handleChat({ id: nick, nick, avatar: '' }, text); res.json({ ok: true });
});
app.get('/api/answers', (_, res) => res.json(game.words.map(w => w.word))); // bantu moderator/testing

(async () => {
  game.setWords(await loadWords());
  game.round = 0; game.newRound();
  server.listen(PORT, () => {
    console.log(`Dashboard   : http://localhost:${PORT}\nGame (OBS)  : http://localhost:${PORT}/?overlay=1\nLeaderboard : http://localhost:${PORT}/leaderboard.html\nSuara (OBS) : http://localhost:${PORT}/tts.html`);
    if (process.env.TIKTOK_USERNAME) connect(process.env.TIKTOK_USERNAME);
  });
})();
