# Panduan verifikasi wajah V4

Dokumen patch V3 lama tidak berlaku untuk arsitektur V4 karena V4 memakai
database baru dan tabel `user_face_templates` dengan profil primary per
perangkat serta canonical lintas perangkat.

Baca panduan lengkap berikut sebelum memasang atau deploy:

- `PANDUAN-V4-DATABASE-BARU.md`
- `database/neon-manual.sql`
- `database/migrate-v4.0.2-mobile-primary.sql` (khusus database V4.0.0/V4.0.1)
- `database/reset-wajah-v4.sql`

Jangan menimpa database V3 produksi dengan SQL V4. Buat project Neon baru agar
data dan suara versi lama tetap aman.
