---
description: "Workflow untuk membuat file-file task backlog di tasks/backlog/ berdasarkan mention file note."
---

# Workflow: Create Backlog

Workflow ini dipanggil dengan instruksi `/create-backlog` disertai mention berkas catatan di `@resource/notes/` (misal: `/create-backlog @resource/notes/note-2026-08-27.md`).

---

## Steps Execution

### Step 1: Baca & Refine Note
1. Agent membaca file catatan yang di-mention (misal: `@resource/notes/note-YYYY-MM-DD.md`).
2. Identifikasi poin-poin pembagian tugas yang menjadi bagian Agent / Developer.
3. Kelompokkan item-item pekerjaan menjadi unit-unit task mandiri yang logis dan fokus.

---

### Step 2: Penentuan Nomor Urut (`NNN`) & Tanggal (`YYYYMMDD`)
1. Agent mengecek seluruh subfolder task (`tasks/backlog/`, `tasks/active/`, `tasks/review/`, `tasks/archive/`) untuk menemukan nomor urut tertinggi saat ini.
2. Tentukan nomor urut berikutnya `NNN` (3 digit, auto-increment, misal: `001`).
3. Ambil tanggal pembuatan backlog hari ini dengan format `YYYYMMDD`.

---

### Step 3: Pembuatan File Backlog (`@tasks/backlog/`)
Untuk setiap unit task yang dipecah:
1. Format nama file wajib: `tasks/backlog/NNN-YYYYMMDD-short-title.md`
2. Gunakan template dari `@resource/templates/backlog-template.md`.
3. Isi bagian metadata (`Source`, `Created`, `Status: Backlog`).
4. Isi bagian `Scope` dengan penjelasan rinci tujuan dan batasan task.
5. Isi bagian `Checklist` secara detail per kategori pengerjaan:
   - `🧪 Logic & Core Functionality`
   - `🎨 UI & Layout`
   - `📦 Maintenance & Refactor`
6. **Wajib Rancang Alur Verifikasi & Testing Komprehensif (`🧪 Alur Verifikasi & Testing (Developer Checklist)`)**:
   - Agent **wajib menyusun skenario testing komprehensif** dengan checkbox (`- [ ]`) yang siap digunakan developer untuk menguji hasil task saat fase review.
   - Skenario harus mencakup:
     - **Persiapan/Prasyarat**: Halaman/menu target yang perlu dibuka atau konfigurasi awal.
     - **Validasi Data & Logika**: Pengujian alur positif, validasi batas/edge case, dan penanganan error.
     - **Verifikasi UI/UX & State**: Pengecekan elemen visual, status badge, responsivitas, dan interaksi komponen.
     - **Ekspektasi Hasil yang Jelas**: Setiap poin pengujian harus menjelaskan ekspektasi yang terukur.

---

### Step 4: Konfirmasi & Laporan ke Developer
1. Tampilkan daftar file backlog baru yang berhasil dibuat di folder `@tasks/backlog/`.
2. Berikan petunjuk ke developer untuk mengaktifkan task tersebut menggunakan workflow `/run-task [file-backlog]`.
