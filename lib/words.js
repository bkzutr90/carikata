// Daftar kata dari KBBI v6.1.0 (unduh otomatis sekali, cache di data/), disaring per tingkat kesulitan
const fs = require('fs');
const path = require('path');
const URL_KBBI = process.env.KBBI_URL || 'https://raw.githubusercontent.com/aryakdaniswara/kbbi-v6-wordlist/main/all_entries_v6.1.0.txt';
const URL_FREQ = process.env.FREQ_URL || 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/id/id_50k.txt';
const DIR = path.join(__dirname, '..', 'data');
const RAW = path.join(DIR, 'kbbi.txt'), FREQ = path.join(DIR, 'freq.txt');

// top = hanya N kata paling sering dipakai orang Indonesia; affix = boleh kata berimbuhan (ber-, me-, -kan, dst)
const LEVELS = {
  mudah:  { top: 4000,  min: 4, max: 8, affix: false },
  sedang: { top: 9000,  min: 4, max: 9, affix: true },
  sulit:  { top: 25000, min: 5, max: 9, affix: true },
};
const DEFAULT_LEVEL = LEVELS[process.env.DIFFICULTY] ? process.env.DIFFICULTY : 'mudah';

const FALLBACK = `hujan angin kopi roti sambal kucing burung kuda rumah mobil motor sepeda jalan pantai hutan bunga pohon daun buku
pensil baju celana topi musik lagu film cerita teman sahabat keluarga senyum mimpi harapan cinta sabar jujur berani cahaya
bahagia rindu sekolah jendela kebun gunung sungai pelangi bintang matahari langit taman sepatu kartu tugas pasar warung`.split(/\s+/);

// Kata sensitif dibuang otomatis (tambah sendiri di data/blacklist.txt)
const SENSITIF = /kondom|seks|porno|bugil|cabul|mesum|telanjang|birahi|kelamin|vagina|penis|payudara|bangsat|bajingan|anjing|babi|sialan|keparat|brengsek|bunuh|pembunuh|mayat|narkoba|ganja|sabu|judi|bom$|teroris|perkosa|lacur|pelacur|sundal|jablay/;
// Nama tempat/orang yang ikut tercatat di KBBI -- dibuang (tambahan sendiri: data/blacklist.txt)
const NAMA = new Set('london amerika panama filipina jamal paris roma eropa asia afrika inggris jerman prancis jepang korea cina india rusia mesir turki arab kanada brasil meksiko jakarta bandung surabaya medan bali jawa sumatra papua islam kristen hindu budha yesus allah tuhan natal ramadan'.split(' '));
const AFFIX = /^(ber|ter|mem|men|meng|meny|pem|pen|peng|peny|per|ke|se|di)|(kan|nya|lah|kah)$/;

async function download(url, file, label) {
  fs.mkdirSync(DIR, { recursive: true });
  console.log(`[kbbi] mengunduh ${label}...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  fs.writeFileSync(file, await res.text());
}
const lines = f => fs.readFileSync(f, 'utf8').split(/\r?\n/);

async function loadWords(level = DEFAULT_LEVEL) {
  const L = { ...LEVELS[level] || LEVELS[DEFAULT_LEVEL] };
  if (process.env.WORD_MIN) L.min = +process.env.WORD_MIN;
  if (process.env.WORD_MAX) L.max = +process.env.WORD_MAX;
  if (process.env.FREQ_TOP) L.top = +process.env.FREQ_TOP;
  try {
    if (!fs.existsSync(RAW)) await download(URL_KBBI, RAW, 'daftar kata KBBI');
    if (L.top > 0 && !fs.existsSync(FREQ)) await download(URL_FREQ, FREQ, 'daftar frekuensi kata');
    const kbbi = new Set(lines(RAW).map(s => s.trim()).filter(w => /^[a-z]+$/.test(w)));
    // urutan daftar frekuensi = urutan paling sering dipakai
    let list = L.top > 0 ? lines(FREQ).slice(0, L.top).map(l => l.split(' ')[0]) : [...kbbi];
    list = list.filter(w =>
      kbbi.has(w) && w.length >= L.min && w.length <= L.max && !SENSITIF.test(w) && !NAMA.has(w) &&
      (L.affix || !AFFIX.test(w)) &&
      !/[^aiueo]{4}/.test(w) && !/(.)\1\1/.test(w) && !/[aiueo]{3}/.test(w) &&
      [...w].filter(c => 'aiueo'.includes(c)).length >= 2);
    const bl = path.join(DIR, 'blacklist.txt');
    if (fs.existsSync(bl)) { const b = new Set(fs.readFileSync(bl, 'utf8').split(/\s+/)); list = list.filter(w => !b.has(w)); }
    list = [...new Set(list)];
    if (list.length < 300) throw new Error('daftar terlalu pendek: ' + list.length);
    console.log(`[kbbi] tingkat "${level}": ${list.length} kata siap dipakai`);
    return list;
  } catch (e) {
    console.warn('[kbbi] gagal memuat KBBI, pakai daftar bawaan kecil:', e.message);
    return FALLBACK;
  }
}
module.exports = { loadWords, LEVELS, DEFAULT_LEVEL };
