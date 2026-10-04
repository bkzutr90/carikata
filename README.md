# show — TikTok Live "Cari Kata Tersembunyi"

1. `npm install`
2. `cp .env.example .env` lalu isi `TIKTOK_USERNAME` (opsional; bisa juga diisi dari dashboard)
3. `npm start` → buka http://localhost:3000
4. Isi @username yang sedang LIVE → **Hubungkan**

- Penonton mengetik kata di chat → kata ketemu, kotak berwarna, +10 poin. Ketik `C7` untuk menyorot kotak.
- Gift menambah poin = jumlah diamond.
- OBS: Browser Source → `http://localhost:3000/?overlay=1` (lebar 560, tinggi 1100, background transparan).
- Tes tanpa live: kolom "Nama tester" + "Ketik kata" di dashboard.
- Jika koneksi ditolak/rate-limited, isi `SESSION_ID` (cookie sessionid TikTok) di `.env`.
