# PRD — Aplikasi Registrasi Pengunjung (Event Check-in System)

**Versi:** 1.1 (update setelah konfirmasi keputusan)
**Tanggal:** 3 September 2026
**Status:** Draft — siap masuk tahap desain teknis

---

## 1. Latar Belakang & Tujuan

Aplikasi ini digunakan untuk mengelola proses registrasi (check-in) pengunjung/peserta suatu event, dari mulai import data peserta, pencarian data saat hari-H, verifikasi identitas oleh petugas, hingga pencatatan status registrasi dan pelaporan.

**Skala event:** ±180 peserta, dengan 5–10 crew/petugas melakukan registrasi secara bersamaan.

**Tujuan utama:**
- Mempercepat proses check-in di lapangan (target: verifikasi + registrasi < 10 detik per orang).
- Mengurangi kesalahan manual (salah kelas, salah kursi, dobel registrasi).
- Menyediakan data & laporan real-time untuk panitia.
- Menjaga jejak audit (siapa meregistrasi siapa, kapan, dan siapa yang membatalkan).

---

## 2. Ruang Lingkup

### 2.1 Termasuk (In Scope — V1)
- Upload Excel → parse kolom (nama, NIK, email, no kursi, kelas) → simpan ke SQLite.
- Deteksi duplikat otomatis saat re-upload (skip data yang sudah ada).
- Pencarian **universal** (bukan strict per satu field) — bisa dari nama, NIK, no kursi, kelas, email.
- Verifikasi manual oleh petugas + **modal konfirmasi** sebelum registrasi.
- Update status registrasi + timestamp + petugas yang bertindak.
- Pembatalan registrasi (khusus role **Official & Admin**), dengan opsi peserta **register ulang setelah dibatalkan** (re-issue gelang).
- Input & edit data manual oleh Admin.
- Dashboard ringkasan real-time.
- Export laporan ke Excel.
- Role-based access: **Admin, Official, Crew**.
- Masking sebagian NIK pada tampilan (NIK penuh hanya untuk Admin & Official).
- Auto-backup database berkala.
- Logging lengkap seluruh aktivitas.

### 2.2 Tidak Termasuk (Out of Scope — V1, disiapkan untuk fase berikutnya)
- **Scan barcode/QR fisik** — untuk V1, "scan" = pencarian manual (search universal berbasis teks). Kolom kode unik (untuk QR) akan **disiapkan strukturnya di database** sejak awal (misal kolom `qr_code` nullable) supaya migrasi ke fase QR di masa depan tidak perlu ubah skema — tapi fitur generate/scan QR-nya sendiri **belum dibangun** di V1.
- Pencetakan gelang otomatis (gelang tetap diberikan manual oleh petugas).
- Aplikasi mobile native (V1 = web app, diakses lewat browser di device apa pun).
- Notifikasi email/SMS otomatis ke peserta.

---

## 3. Aktor & Hak Akses

**Autentikasi:** login menggunakan **username + password** (password di-hash dengan bcrypt/argon2), dengan session timeout untuk keamanan (misal auto-logout setelah idle 30–60 menit, disesuaikan saat development).

| Fitur | Admin | Official | Crew |
|---|---|---|---|
| Upload Excel | ✅ | ❌ | ❌ |
| Input data manual | ✅ | ❌ | ❌ |
| Edit data peserta | ✅ | ❌ | ❌ |
| Cari peserta (search universal) | ✅ | ✅ | ✅ |
| Registrasi peserta (check-in) | ✅ | ✅ | ✅ |
| Batalkan registrasi | ✅ | ✅ | ❌ |
| Register ulang peserta yang dibatalkan | ✅ | ✅ | ✅ (mengikuti aturan registrasi normal) |
| Lihat NIK penuh (tidak tersamar) | ✅ | ✅ | ❌ (selalu tersamar) |
| Lihat dashboard | ✅ | ✅ | 🟡 *masih perlu diputuskan (lihat Bagian 9)* |
| Export laporan Excel | ✅ | ✅ | ❌ |
| Kelola user & role | ✅ | 🟡 *masih perlu diputuskan (lihat Bagian 9)* | ❌ |
| Lihat log aktivitas | ✅ | ✅ (opsional, log miliknya sendiri) | ❌ |

---

## 4. Alur Pengguna (User Flow)

### 4.1 Upload Data Peserta (Admin)
1. Admin buka menu **Upload Excel**.
2. Sistem tampilkan **template kolom wajib**: `nama, nik, email, no_kursi, kelas`.
3. Admin upload file → sistem **parsing & validasi** tiap baris:
   - NIK harus 16 digit numerik.
   - **Email wajib divalidasi formatnya** (harus format email yang benar).
   - No kursi & kelas tidak boleh kosong.
4. Sistem tampilkan **preview** hasil parsing sebelum commit, dengan highlight baris **error/invalid**.
5. Sistem cek **duplikat** terhadap data yang sudah ada di DB berdasarkan **kombinasi NIK dan email** (lihat 4.1.1).
6. Admin konfirmasi import → sistem simpan data baru, **skip data yang sudah ada**, tampilkan ringkasan: `X baris baru ditambahkan, Y baris di-skip (sudah ada), Z baris gagal (error format)`.
7. Semua hasil import dicatat di log.

#### 4.1.1 Logika Deteksi Duplikat saat Re-upload
- **Kunci pembanding: NIK DAN email** (baris dianggap duplikat/sudah ada jika NIK **atau** email-nya cocok dengan data yang sudah tersimpan — perlu disepakati saat development apakah "match" berarti keduanya harus sama, atau salah satu cukup; rekomendasi: **jika salah satu (NIK atau email) sudah ada, tandai sebagai duplikat & skip**, supaya lebih aman mencegah data ganda akibat typo di salah satu field).
- Jika NIK/email kosong atau tidak valid pada baris tsb → baris dianggap **error**, tidak diimport, tidak dianggap duplikat.
- Data yang di-skip tetap dicatat di ringkasan hasil upload (bukan silent skip).

### 4.2 Pencarian & Registrasi (Admin/Official/Crew)
1. Petugas buka menu **Cari/Registrasi**.
2. Ketik kata kunci apa saja: nama, NIK (sebagian/lengkap), no kursi, kelas, email → **universal search**, hasil realtime (debounced ±300ms).
3. Pilih peserta dari hasil pencarian → tampil **detail lengkap**:
   - Nama, NIK (tersamar untuk Crew: `1234********01`; penuh untuk Admin/Official), email, no kursi, kelas, status (**Belum Registrasi / Sudah Registrasi / Dibatalkan**), waktu registrasi terakhir (jika ada), riwayat pembatalan (jika ada).
4. Petugas cocokkan data dengan identitas fisik peserta (di luar sistem).
5. Jika cocok → klik tombol **"Registered"**.
6. Sistem tampilkan **modal konfirmasi**: *"Konfirmasi registrasi untuk [Nama] — [Kelas] — Kursi [No]?"* dengan tombol **Batal / Konfirmasi**.
7. Setelah konfirmasi → status jadi **"Sudah Registrasi"**, sistem catat waktu & petugas.
8. Peserta diberi gelang secara fisik oleh petugas (di luar sistem).

**Penanganan kasus khusus:**
- Jika peserta **sudah "Sudah Registrasi"** → tombol Registered **disabled**, tampilkan info kapan & oleh siapa diregistrasi (cegah double check-in).
- Jika peserta berstatus **"Dibatalkan"** → tombol Registered **tetap aktif** (bisa diregistrasi ulang / re-issue gelang), sesuai keputusan bahwa peserta yang dibatalkan boleh check-in lagi nantinya.
- Jika peserta **tidak ditemukan** → pesan jelas + saran cek/input manual ke Admin.

### 4.3 Pembatalan Registrasi (Official & Admin saja)
1. Buka data peserta berstatus "Sudah Registrasi".
2. Klik **"Batalkan Registrasi"**.
3. Modal konfirmasi + **wajib isi alasan pembatalan** (untuk audit — misal "salah orang", "gelang rusak", dsb).
4. Status berubah jadi **"Dibatalkan"**. Waktu & user pembatalan dicatat. Riwayat registrasi sebelumnya **tidak dihapus**, tersimpan sebagai histori.
5. Peserta berstatus "Dibatalkan" dapat **diregistrasi ulang kapan saja** melalui flow normal di 4.2 (misal saat gelang pengganti/re-issue diberikan) — setiap siklus registrasi/pembatalan tercatat lengkap di log/histori, bukan menimpa data lama.

### 4.4 Input & Edit Data Manual (Admin)
- Input manual: form dengan field sama seperti Excel, validasi sama (termasuk cek duplikat NIK & email).
- Edit data: Admin bisa ubah field apa pun **kecuali** riwayat status registrasi (itu hanya lewat flow registrasi/pembatalan di 4.2/4.3). Setiap edit dicatat di log (field, nilai lama→baru, siapa, kapan).

### 4.5 Dashboard
Ringkasan real-time:
- Total peserta terdaftar (dari total ±180).
- Total sudah registrasi vs belum vs dibatalkan (dengan persentase).
- Breakdown per kelas (sudah/belum/total per kelas).
- Grafik jumlah check-in per waktu (per 15/30 menit) — untuk lihat jam sibuk.
- Jumlah & daftar pembatalan beserta alasan.

### 4.6 Export Laporan
- Export ke `.xlsx`, dengan filter opsional (per kelas, per status, per rentang waktu).
- Kolom laporan: nama, NIK (**full — export hanya bisa dilakukan Admin/Official**), email, kelas, no kursi, status, waktu registrasi, petugas yang meregistrasi, riwayat pembatalan + alasan (jika ada).

---

## 5. Kebutuhan Fungsional Detail

| ID | Requirement |
|---|---|
| F1 | Sistem dapat mengimpor file Excel (.xlsx) dengan kolom: nama, nik, email, no_kursi, kelas |
| F2 | Sistem memvalidasi format tiap baris (termasuk format email) sebelum commit, dengan preview + error report |
| F3 | Sistem melakukan skip otomatis terhadap baris yang NIK atau email-nya sudah terdaftar |
| F4 | Sistem menyediakan pencarian universal dengan hasil realtime |
| F5 | Sistem menampilkan seluruh data peserta terkait saat dipilih dari hasil pencarian |
| F6 | Sistem menyamarkan sebagian digit NIK untuk role Crew; Admin & Official melihat NIK penuh |
| F7 | Sistem menampilkan modal konfirmasi sebelum status berubah menjadi "Registered" |
| F8 | Sistem mencegah double check-in (tombol registrasi disabled jika sudah "Sudah Registrasi") |
| F9 | Sistem mencatat waktu & petugas setiap kali status registrasi berubah (registrasi, pembatalan, registrasi ulang) |
| F10 | Hanya role Official & Admin yang dapat membatalkan registrasi, wajib isi alasan |
| F11 | Peserta berstatus "Dibatalkan" dapat diregistrasi ulang (re-issue) melalui flow registrasi normal |
| F12 | Admin dapat input & edit data peserta secara manual |
| F13 | Sistem menyediakan dashboard ringkasan real-time |
| F14 | Sistem dapat mengekspor data/laporan ke Excel (NIK full) — akses terbatas Admin/Official |
| F15 | Sistem menerapkan role-based access control (Admin, Official, Crew) dengan login username+password |
| F16 | Sistem mencatat log lengkap untuk semua aktivitas signifikan |
| F17 | Sistem menampilkan pesan jelas jika peserta tidak ditemukan |
| F18 | Sistem melakukan auto-backup database secara berkala |

---

## 6. Skema Data (SQLite)

### `participants`
| Kolom | Tipe | Keterangan |
|---|---|---|
| id | INTEGER PK AUTOINCREMENT | |
| nama | TEXT NOT NULL | |
| nik | TEXT NOT NULL | 16 digit; unique index (bersama email, lihat catatan) |
| email | TEXT NOT NULL | format tervalidasi; unique index |
| no_kursi | TEXT | |
| kelas | TEXT | |
| qr_code | TEXT NULL UNIQUE | disiapkan untuk fase 2 (scan QR), belum dipakai di V1 |
| status | TEXT CHECK(status IN ('belum','registered','dibatalkan')) DEFAULT 'belum' | |
| registered_at | DATETIME NULL | |
| registered_by | INTEGER NULL (FK → users.id) | |
| cancelled_at | DATETIME NULL | |
| cancelled_by | INTEGER NULL (FK → users.id) | |
| cancel_reason | TEXT NULL | |
| source | TEXT CHECK(source IN ('excel_upload','manual')) | |
| created_at | DATETIME DEFAULT now | |
| updated_at | DATETIME | |

> Catatan: karena peserta bisa registrasi → dibatalkan → registrasi ulang berkali-kali, riwayat detail tiap siklus disimpan terpisah di `registration_history`, sementara tabel `participants` hanya menyimpan **status & data terakhir**.

### `registration_history`
| Kolom | Tipe | Keterangan |
|---|---|---|
| id | INTEGER PK | |
| participant_id | INTEGER FK | |
| action | TEXT CHECK(action IN ('register','cancel')) | |
| performed_by | INTEGER FK (users.id) | |
| reason | TEXT NULL | diisi khusus saat `cancel` |
| created_at | DATETIME | |

### `users`
| Kolom | Tipe | Keterangan |
|---|---|---|
| id | INTEGER PK | |
| username | TEXT UNIQUE | |
| password_hash | TEXT | |
| role | TEXT CHECK(role IN ('admin','official','crew')) | |
| full_name | TEXT | |
| active | BOOLEAN DEFAULT 1 | |
| created_at | DATETIME | |

### `activity_logs`
| Kolom | Tipe | Keterangan |
|---|---|---|
| id | INTEGER PK | |
| user_id | INTEGER FK | |
| action | TEXT | `LOGIN`, `UPLOAD_EXCEL`, `REGISTER`, `CANCEL_REGISTRATION`, `EDIT_PARTICIPANT`, `MANUAL_ADD`, `EXPORT_REPORT` |
| target_participant_id | INTEGER NULL FK | |
| detail | TEXT (JSON) | field yang berubah / metadata relevan |
| ip_address | TEXT | |
| created_at | DATETIME | |

### `upload_batches`
| Kolom | Tipe | Keterangan |
|---|---|---|
| id | INTEGER PK | |
| filename | TEXT | |
| uploaded_by | INTEGER FK | |
| total_rows | INTEGER | |
| inserted_count | INTEGER | |
| skipped_count | INTEGER | |
| error_count | INTEGER | |
| error_detail | TEXT (JSON) | daftar baris + alasan gagal |
| created_at | DATETIME | |

---

## 7. Kebutuhan Non-Fungsional

| Aspek | Target |
|---|---|
| **Performa pencarian** | Hasil search tampil < 300ms (dataset ±180 peserta — sangat ringan, indexing pada `nama`, `nik`, `no_kursi`, `kelas`, `email` lebih dari cukup) |
| **Loading halaman** | < 1 detik |
| **Concurrency** | 5–10 device/petugas mengakses & registrasi bersamaan tanpa konflik data — dengan skala 180 peserta dan VPS 4 vCPU/4GB RAM, ini jauh di bawah kapasitas server, tidak perlu tuning khusus |
| **Keamanan** | **Aplikasi diakses via internet (VPS) → HTTPS wajib** (bukan opsional), password di-hash, session token dengan expiry, NIK tersamar untuk Crew, rate-limiting pada endpoint login untuk cegah brute-force, firewall VPS hanya buka port yang perlu (80/443 + SSH dibatasi IP tertentu) |
| **Reliabilitas** | **Auto-backup database berkala dikonfirmasi dibutuhkan** — rekomendasi: backup otomatis tiap 15 menit selama event berlangsung + backup manual on-demand oleh Admin, file `.sqlite` bertanggal disimpan **di luar VPS** (misal di-download berkala ke storage terpisah/cloud storage) agar tidak hilang jika VPS bermasalah |
| **Audit** | Semua perubahan status/data tercatat, tidak bisa dihapus oleh user biasa |
| **Kompatibilitas** | Bisa diakses dari browser modern di laptop/tablet/HP petugas |

---

## 8. Rekomendasi Arsitektur & Tech Stack

**Deployment: VPS** (dikonfirmasi, spesifikasi tersedia: **4 vCPU / 4GB RAM**, akses online biasa dengan HTTPS standar) — spek ini jauh lebih dari cukup untuk skala 180 peserta & 5–10 device bersamaan; bottleneck di beban seperti ini praktis tidak akan terjadi. Koneksi internet di venue event juga sudah dianggap aman/stabil, jadi risiko konektivitas yang sempat saya soroti sebelumnya bisa diabaikan.

- **Model:** Backend web app di-deploy di 1 VPS, menyimpan SQLite (mode `WAL`) di disk VPS. Semua petugas (5–10 device) akses via browser ke **domain/subdomain** yang mengarah ke VPS — tidak perlu instalasi apa pun di device.
- **Backend:** Node.js (Express/Fastify) atau Python (FastAPI) + SQLite (WAL mode). Dengan skala 180 peserta & 5–10 user bersamaan, SQLite di VPS **masih sangat memadai** — tidak perlu Postgres/MySQL.
- **Web server / reverse proxy:** Nginx di depan aplikasi, untuk **HTTPS (Let's Encrypt/Certbot)**, dan sebagai lapisan keamanan tambahan (rate limiting, header security).
- **Frontend:** Web app ringan (React atau HTML+JS sederhana), responsif untuk tablet/HP petugas.
- **Excel parsing:** `xlsx` (Node) / `openpyxl` (Python).
- **Auth:** JWT atau session cookie, **wajib dikirim hanya via HTTPS** (secure cookie flag), karena trafiknya lewat internet publik, bukan jaringan lokal tertutup.
- **Process management:** aplikasi backend dijalankan sebagai service (`pm2` untuk Node, atau `systemd` unit) agar auto-restart jika VPS reboot/crash — penting karena tidak ada orang yang "menyalakan laptop" seperti skenario lokal.
- **Keamanan VPS:** firewall (`ufw`) hanya buka port 80/443 (+ SSH pada port custom/dibatasi IP), disable root login SSH, update OS berkala.
- **Backup off-VPS:** karena SQLite adalah 1 file, backup berkala (misal via `cron`) yang men-transfer file `.sqlite` ke lokasi lain (S3-compatible storage, atau di-download manual oleh Admin) — supaya tidak ada single point of failure di 1 VPS saja.

> ⚠️ **Catatan koneksi saat hari-H:** karena sekarang tergantung koneksi internet ke VPS (bukan wifi lokal), pastikan lokasi event punya koneksi internet yang stabil (atau siapkan failover, misal tethering) — ini jadi risiko baru dibanding skenario server lokal sebelumnya. Kalau venue event punya risiko koneksi internet tidak stabil, ini perlu jadi pertimbangan serius sebelum commit ke arsitektur VPS-only.

---

## 9. Hal yang Masih Perlu Diputuskan (Open Questions Tersisa)

1. **Akses dashboard untuk Crew** — apakah Crew boleh lihat dashboard ringkasan (read-only), atau menu ini khusus Admin/Official saja?
2. **Kelola user & role** — apakah hanya Admin yang bisa buat/nonaktifkan akun user, atau Official juga diberi akses ini?
3. **Mode print/label sederhana** — apakah dibutuhkan cetak struk kecil/label sebagai bukti fisik registrasi (selain gelang), atau gelang fisik saja sudah cukup sebagai bukti?
4. **Batas kapasitas per kelas** — apakah sistem perlu memperingatkan jika suatu kelas sudah mencapai kapasitas maksimum peserta?
5. **Retensi data setelah event selesai** — berapa lama data pribadi peserta (termasuk NIK) akan disimpan setelah event berakhir, dan apakah perlu proses penghapusan/anonimisasi terjadwal (relevan untuk kepatuhan UU PDP)?
6. **Domain** — sudah punya domain/subdomain yang akan diarahkan ke VPS ini (untuk setup HTTPS via Let's Encrypt), atau perlu daftar dulu?

---

## 10. Metrik Keberhasilan

- Rata-rata waktu proses registrasi per peserta < 10 detik.
- 0 insiden double check-in (gelang ganda) akibat bug sistem.
- Downtime sistem selama event < 1%.
- 100% aktivitas signifikan (registrasi, pembatalan, registrasi ulang, edit) tercatat di log.

---

## 11. Roadmap Singkat

| Fase | Cakupan |
|---|---|
| **V1 (MVP)** | Semua fitur di dokumen ini: upload, universal search, registrasi + modal konfirmasi, batal + registrasi ulang, dashboard, export, role Admin/Official/Crew, masking NIK, auto-backup, log lengkap |
| **V2** | Scan QR code fisik (kolom `qr_code` sudah disiapkan di skema V1), print label/struk registrasi |
| **V3** | Multi-event support, analytics lanjutan, integrasi sistem lain |

---

*Dokumen sudah mengakomodasi seluruh keputusan yang dikonfirmasi. Sisa 6 pertanyaan di Bagian 9 disarankan diputuskan sebelum development dimulai, tapi tidak menghalangi tim untuk mulai membangun skema database & backend inti (Bagian 6–8) karena tidak mempengaruhi struktur data utama.*
