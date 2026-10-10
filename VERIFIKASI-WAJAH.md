# Arsitektur verifikasi wajah V4

## Profil descriptor

V4 tidak menganggap perangkat sebagai identitas. Identitas tetap wajah yang
didaftarkan pada akun, sedangkan profil hanya menentukan pipeline descriptor
yang konsisten.

| Role | Engine | Kegunaan |
| --- | --- | --- |
| `desktop-primary` | `human-webgl-v1` | Mempertahankan jalur desktop V3 |
| `mobile-primary` | `human-wasm-v1` | Jalur HP ke HP |
| `canonical-cross-device` | `human-wasm-v1` | Jalur lintas perangkat |

Keduanya memakai model `human-3.3.6-faceres-1024-v1`, descriptor 1024 angka,
median beberapa frame, dan ambang Euclidean-style `0.68`. Pada satu percobaan,
server mengambil tepat satu record berdasarkan `user_id + template_role +
engine`; server tidak mencoba template atau algoritma lain bila hasil gagal.

## Pendaftaran

- PC maupun HP hanya melakukan satu pemindaian liveness dan menyimpan satu
  template `canonical-cross-device` (WASM, preprocessing 480×480).
- Sebelum di-resize, frame dipotong persegi di tengah (sama dengan pratinjau
  kamera) sehingga wajah tidak gepeng pada kamera dengan rasio berbeda
  (webcam 16:9, HP potret). Kamera yang sudah persegi menghasilkan frame identik.
- `desktop-primary` dan `mobile-primary` tidak dibuat lagi untuk pendaftar baru,
  tetapi tetap dipakai untuk akun lama yang sudah memilikinya.
- Foto/video tidak diunggah. Descriptor dikompresi dan dienkripsi AES-256-GCM.
- Challenge bertanda tangan mengikat mode, user, urutan gestur, role, engine,
  versi model, dan kelas perangkat.

## Login dan bilik suara

- Pendaftar baru selalu diverifikasi dengan `canonical-cross-device` di PC
  maupun HP.
- Akun lama: desktop memakai `desktop-primary` dan HP memakai `mobile-primary`
  bila tersedia; selain itu memakai `canonical-cross-device`.
- Model wajah dimuat di latar belakang sejak halaman verifikasi dibuka (pada
  pendaftaran sejak langkah biodata) dan disimpan di cache browser, sehingga
  tombol pemindaian langsung siap.
- Login/verifikasi selalu selesai dalam satu pemindaian. Sistem tidak lagi
  membuat template primary perangkat kedua setelah verifikasi berhasil.
- Akun lama yang hanya memiliki satu template primary tidak bisa dipakai lintas
  perangkat sampai mempunyai template canonical.
- Verifikasi sesi berlaku 15 menit dan `POST /api/vote` tetap memeriksa cookie
  sesi bertanda tangan. Status database lama tidak membuka bilik suara.

## Database

Template aktif disimpan pada `user_face_templates`. Partial unique index
memastikan maksimal satu template aktif per user dan role. Reset admin mengisi
`revoked_at`, bukan menghapus riwayat, kemudian mengosongkan
`users.face_verified_at`.

Gunakan database Neon V4 baru dan jalankan `database/neon-manual.sql`. Detail
instalasi, matriks pengujian, backup, dan reset tersedia di
`PANDUAN-V4-DATABASE-BARU.md`.

## Batasan operasional

Kamera browser memerlukan HTTPS (kecuali `localhost`). Pengujian fisik tetap
wajib pada Android/iPhone dan desktop yang benar-benar digunakan. Sistem ini
adalah kontrol akses biometrik aplikasi, bukan layanan KYC tersertifikasi.
