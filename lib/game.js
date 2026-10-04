// Game "Cari Kata Tersembunyi" (word search) — penonton menebak lewat chat
let WORDS = [];

const ROWS = 17, COLS = 15, TOTAL = 20;
const COLORS = ['#ff2d95', '#ff8a1f', '#ffd93b', '#2ee66b', '#22d3ee', '#4aa8ff', '#b36bff', '#ff6b6b', '#8be28b', '#f5a3ff'];
const FILL = 'AAAAEEEIIINNNUUOKRTSLMDGBPHJCWY';
const rnd = n => Math.floor(Math.random() * n);

class Game {
  constructor() { this.scores = new Map(); this.newRound(); }
  setWords(list) { WORDS = list; }

  newRound() {
    const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(''));
    const pool = [...WORDS].sort(() => Math.random() - 0.5);
    const words = [];
    for (const w of pool) {
      if (words.length >= TOTAL) break;
      const W = w.toUpperCase();
      for (let t = 0; t < 120; t++) {
        const vert = Math.random() < 0.45;
        const r = rnd(vert ? ROWS - W.length + 1 : ROWS), c = rnd(vert ? COLS : COLS - W.length + 1);
        const cells = [...W].map((_, i) => (vert ? [r + i, c] : [r, c + i]));
        if (cells.every(([y, x], i) => !grid[y][x] || grid[y][x] === W[i])) {
          cells.forEach(([y, x], i) => (grid[y][x] = W[i]));
          words.push({ word: W, cells, found: null });
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
      if (w) {
        w.found = { ...user, color: COLORS[this.words.filter(x => x.found).length % COLORS.length] };
        this.addScore(user, 10);
        this.done = this.words.every(x => x.found);
        return { type: 'word', entry: w };
      }
    }
    return null;
  }

  state() {
    return {
      grid: this.grid, total: this.words.length, round: this.round, done: this.done,
      found: this.words.filter(w => w.found).map(w => ({ word: w.word, cells: w.cells, user: w.found })),
      top: [...this.scores.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.points - a.points).slice(0, 20),
    };
  }
}
module.exports = { Game };
