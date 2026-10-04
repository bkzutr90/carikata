// Ambil daftar kata dari KBBI v6.1.0 (unduh otomatis sekali, lalu cache di data/)
const fs = require('fs');
const path = require('path');
const URL_KBBI = process.env.KBBI_URL || 'https://raw.githubusercontent.com/aryakdaniswara/kbbi-v6-wordlist/main/all_entries_v6.1.0.txt';
const DIR = path.join(__dirname, '..', 'data');
const RAW = path.join(DIR, 'kbbi.txt');
const FREQ = path.join(DIR, 'freq.txt');
const URL_FREQ = process.env.FREQ_URL || 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/id/id_50k.txt';
const FREQ_TOP = +process.env.FREQ_TOP || 25000; // 0 = pakai semua kata KBBI (banyak kata asing)
const MIN = +process.env.WORD_MIN || 5, MAX = +process.env.WORD_MAX || 9;

const FALLBACK = `hafal selisih kartu pendirian publikasi mengatur pembelian kejutan lendir sepatu digital isolasi pegawai senyuman
sejarah istilah festival monitor sekolah jendela tetangga kebun gunung sungai pelangi bintang matahari hujan petir angin
sambal kucing burung mobil motor sepeda pantai hutan bunga pohon musik cerita teman sahabat keluarga senyum mimpi harapan
sabar jujur berani cahaya bahagia rindu pelajar petualang rahasia permainan juara semangat`.split(/\s+/);

// Filter kata "enak ditebak": huruf a-z saja (tanpa tanda hubung/spasi/aksara asing),
// tidak ada 3 konsonan berurutan, minimal 2 vokal, bukan awalan/akhiran.
// Kata sensitif dibuang otomatis agar aman untuk live (tambah sendiri di data/blacklist.txt)
const SENSITIF = /kondom|seks|porno|bugil|cabul|mesum|telanjang|birahi|kelamin|vagina|penis|payudara|bangsat|bajingan|anjing|babi|sialan|keparat|brengsek|bunuh|pembunuh|mayat|narkoba|ganja|sabu|judi|bom$|teroris|perkosa|lacur|pelacur|sundal|jablay/;
const V = 'aiueo';
const ok = w => {
  if (!new RegExp(`^[a-z]{${MIN},${MAX}}$`).test(w) || SENSITIF.test(w)) return false;
  if (/[^aiueo]{4}/.test(w) || /(.)\1\1/.test(w) || /[aiueo]{3}/.test(w)) return false;
  if (/(ng|ny|sy|kh|gh)?[^aiueo]{3}/.test(w.replace(/ng|ny|sy|kh|gh/g, 'x'))) return false;
  return [...w].filter(c => V.includes(c)).length >= 2;
};

async function download(url, file, label) {
  fs.mkdirSync(DIR, { recursive: true });
  console.log(`[kbbi] mengunduh ${label}...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  fs.writeFileSync(file, await res.text());
}

async function loadWords() {
  try {
    if (!fs.existsSync(RAW)) await download(URL_KBBI, RAW, 'daftar kata KBBI');
    let list = fs.readFileSync(RAW, 'utf8').split(/\r?\n/).map(s => s.trim().toLowerCase()).filter(ok);
    // Hanya kata KBBI yang juga umum dipakai sehari-hari (irisan dgn daftar frekuensi)
    if (FREQ_TOP > 0) {
      try {
        if (!fs.existsSync(FREQ)) await download(URL_FREQ, FREQ, 'daftar frekuensi kata');
        const common = new Set(fs.readFileSync(FREQ, 'utf8').split(/\r?\n/).slice(0, FREQ_TOP).map(l => l.split(' ')[0]));
        const f = list.filter(w => common.has(w));
        if (f.length >= 500) list = f; else throw new Error('irisan terlalu sedikit');
      } catch (e) { console.warn('[kbbi] filter kata umum dilewati:', e.message); }
    }
    // blacklist opsional: data/blacklist.txt (satu kata per baris)
    const bl = path.join(DIR, 'blacklist.txt');
    if (fs.existsSync(bl)) { const b = new Set(fs.readFileSync(bl, 'utf8').split(/\s+/)); list = list.filter(w => !b.has(w)); }
    list = [...new Set(list)];
    if (list.length < 500) throw new Error('daftar terlalu pendek');
    console.log(`[kbbi] ${list.length} kata KBBI siap dipakai (${MIN}-${MAX} huruf)`);
    return list;
  } catch (e) {
    console.warn('[kbbi] gagal memuat KBBI, pakai daftar bawaan kecil:', e.message);
    return FALLBACK;
  }
}
module.exports = { loadWords };
