// Game "Cari Kata Tersembunyi" (word search) — penonton menebak lewat chat
let WORDS = [];

const ROWS = 17, COLS = 15, TOTAL = 20;
const COLORS = ['#ff2d95', '#ff8a1f', '#ffd93b', '#2ee66b', '#22d3ee', '#4aa8ff', '#b36bff', '#ff6b6b', '#8be28b', '#f5a3ff'];
const FILL = 'AAAAEEEIIINNNUUOKRTSLMDGBPHJCWY';
const rnd = n => Math.floor(Math.random() * n);

// 8 arah: [dBaris, dKolom]
const DIRS = [
  [0, 1], [1, 0],      // mendatar, ke bawah
  [1, 1], [1, -1],     // serong kanan-bawah, serong kiri-bawah
  [0, -1], [-1, 0],    // mendatar terbalik, ke atas
  [-1, -1], [-1, 1],   // serong kiri-atas, serong kanan-atas
];
// bobot: arah "normal" (kiri→kanan, atas→bawah) lebih sering supaya tetap mudah dibaca penonton
// ubah angkanya untuk mengatur tingkat kesulitan (0 = arah itu tidak dipakai)
const DIR_WEIGHTS = [3, 3, 2, 2, 0, 0, 0, 0];
const pickDir = () => {
  const total = DIR_WEIGHTS.reduce((a, b) => a + b, 0);
  let x = Math.random() * total;
  for (let i = 0; i < DIRS.length; i++) { if ((x -= DIR_WEIGHTS[i]) < 0) return DIRS[i]; }
  return DIRS[0];
};

class Game {
  constructor() { this.scores = new Map(); this.newRound(); }
  setWords(list) { WORDS = list; this.used = new Set(); }

  newRound() {
    const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(''));
    this.used = this.used || new Set();
    let fresh = WORDS.filter(w => !this.used.has(w));
    if (fresh.length < 60) { this.used.clear(); fresh = [...WORDS]; }
    const pool = fresh.sort(() => Math.random() - 0.5);
    const words = [];
    for (const w of pool) {
      if (words.length >= TOTAL) break;
      const W = w.toUpperCase();
      for (let t = 0; t < 200; t++) {
        const [dr, dc] = pickDir();
        // rentang titik awal supaya seluruh kata muat di dalam papan
        const rMin = dr < 0 ? W.length - 1 : 0, rMax = dr > 0 ? ROWS - W.length : ROWS - 1;
        const cMin = dc < 0 ? W.length - 1 : 0, cMax = dc > 0 ? COLS - W.length : COLS - 1;
        if (rMax < rMin || cMax < cMin) continue;
        const r = rMin + rnd(rMax - rMin + 1), c = cMin + rnd(cMax - cMin + 1);
        const cells = [...W].map((_, i) => [r + dr * i, c + dc * i]);
        if (cells.every(([y, x], i) => !grid[y][x] || grid[y][x] === W[i])) {
          cells.forEach(([y, x], i) => (grid[y][x] = W[i]));
          words.push({ word: W, cells, found: null }); this.used.add(w);
          break;
        }
      }
    }
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (!grid[y][x]) grid[y][x] = FILL[rnd(FILL.length)];
    Object.assign(this, { grid, words, done: false, round: (this.round || 0) + 1 });
  }

  addScore(user, pts) {
    const s = this.scores.get(user.id) || { nick: user.nick, avatar: user.avatar, points: 0 };
    s.points += pts; s.nick = user.nick; s.avatar = user.avatar || s.avatar;
    this.scores.set(user.id, s);
  }

  // return {type:'word', entry} | {type:'cell', r, c} | null
  guess(user, text) {
    for (const tok of String(text).trim().split(/\s+/)) {
      const m = tok.match(/^([a-q])(\d{1,2})$/i);
      if (m && +m[2] >= 1 && +m[2] <= COLS) return { type: 'cell', r: m[1].toUpperCase().charCodeAt(0) - 65, c: +m[2] - 1 };
      const w = this.words.find(x => !x.found && x.word === tok.toUpperCase());
      if (w) return { type: 'word', entry: this.claim(w, user) };
    }
    return null;
  }

  // tandai kata ditemukan oleh user (+10 poin)
  claim(w, user, via = 'chat') {
    w.found = { ...user, via, at: Date.now(), color: COLORS[this.words.filter(x => x.found).length % COLORS.length] };
    this.addScore(user, 10);
    this.done = this.words.every(x => x.found);
    return w;
  }

  // gift: buka kata acak yang belum ketemu atas nama pemberi gift
  reveal(user) {
    const left = this.words.filter(x => !x.found);
    if (!left.length) return null;
    return this.claim(left[rnd(left.length)], user, 'gift');
  }

  state() {
    return {
      grid: this.grid, total: this.words.length, round: this.round, done: this.done,
      found: this.words.filter(w => w.found).map(w => ({ word: w.word, cells: w.cells, user: w.found })).sort((a, b) => a.user.at - b.user.at),
      top: [...this.scores.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.points - a.points).slice(0, 20),
    };
  }
}
module.exports = { Game };
