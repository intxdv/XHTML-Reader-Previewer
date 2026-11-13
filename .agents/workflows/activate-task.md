---
description: "Workflow untuk mengaktifkan task dari backlog, mengeksekusi checklist dengan atomic commit, memverifikasi secara ketat (Strict Gatekeeper), dan mengarsipkan setelah persetujuan developer."
---

# Workflow: Activate Task

Workflow ini dipanggil dengan instruksi `/activate-task` disertai mention file task backlog di `@tasks/backlog/`.

---

## Steps Execution

### Step 1: Validasi & Aktivasi Task
1. Agent memeriksa file backlog yang di-mention di `@tasks/backlog/`.
2. Pindahkan atau buat salinan file backlog tersebut ke folder `@tasks/active/`.
3. Ubah header status di dalam file task aktif menjadi: `Status: Active`.
4. Laporkan kepada developer bahwa task telah diaktifkan dan mulai dikerjakan.

---

### Step 2: Eksekusi Poin Checklist & Atomic Commit (1 Poin = 1 Commit)
> [!IMPORTANT]
> **Git Execution Scope (Mode-Aware)**:
> - **Mode 1 (Native / Root Git Repo)**: Jika root workspace memiliki direktori `.git`, operasi git (`git status`, `git commit`) dijalankan langsung di root workspace. File `/tasks/` otomatis diproteksi oleh `.gitignore`.
> - **Mode 2 (Guest / Subfolder Repo)**: Jika root bukan git repo, operasi git **HANYA boleh dijalankan di dalam folder core project** (`Cwd: <core-project-folder>` atau `git -C <core-project-folder>`). Dilarang git di root untuk mencegah polusi repo upstream.

1. Agent membaca daftar checklist dalam file task di `@tasks/active/`.
2. Untuk **setiap 1 poin checklist** yang dikerjakan:
   a. Lakukan pengodean / penyesuaian yang diperlukan secara presisi pada codebase (mengikuti prinsip *Surgical Changes* & *Simplicity First*).
   b. Jalankan verifikasi / pengujian spesifik yang relevan (misal: static analysis, linter, atau test runner sesuai stack).
   c. Lakukan **1 kali atomic commit** menggunakan format commit message:
      ```bash
      # Mode 1 (Root Git):
      git commit -m "<type>(<scope>): <deskripsi ringkas poin>"

      # Mode 2 (Subfolder Git):
      git -C <core-project-folder> commit -m "<type>(<scope>): <deskripsi ringkas poin>"
      ```
   d. Perbarui centang di file task aktif menjadi `- [x]` dan catat hash commit di sebelahnya.

---

### Step 3: Pengajuan ke Review Phase & Strict Verification Gatekeeper
> [!CAUTION]
> **Aturan Strict Verification (AI Gatekeeper)**:
> Developer sering kali fokus menguji secara visual di browser dan hanya membahas hasilnya di chat tanpa mengisi file checklist secara manual. 
> **Agent WAJIB BERTINDAK SEBAGAI VERIFIER KETAT**:
> 1. Agent **DILARANG** menganggap task selesai atau langsung mengarsipkannya sebelum SELURUH poin checklist dijawab/dikonfirmasi secara eksplisit oleh developer.
> 2. Poin sistem/kode (build, lint, console error) diverifikasi sendiri oleh Agent dengan bukti output perintah.
> 3. Poin visual/interaksi/feeling **WAJIB DITANYAKAN SATU PER SATU ATAU DALAM DAFTAR NOMOR** kepada developer:
>    > *"Berikut poin verifikasi untuk task ini. Mohon konfirmasi apakah semuanya sudah sesuai di layarmu:*
>    > 1. *[Poin A]: Apakah ... sudah berfungsi normal?*
>    > 2. *[Poin B]: Apakah tampilan di mobile sudah rapi tanpa overflow?*
>    > 3. *[Poin C]: Apakah ...?"*
> 4. Jika developer hanya merespons sebagian atau mengalihkan topik ke hal lain, Agent **WAJIB MENAGIH** poin yang belum terjawab:
>    > *"Poin 1 sudah terkonfirmasi aman. Namun poin 2 dan 3 belum kamu jawab. Apakah poin 2 dan 3 sudah berjalan sesuai ekspektasi di layarmu?"*
> 5. Setelah developer mengonfirmasi ("ya", "aman", "oke"), Agent yang memperbarui centang `- [x]` di dalam file task di `@tasks/review/`.

1. Pindahkan file task dari `@tasks/active/` ke `@tasks/review/` dengan header `Status: Review`.
2. Jalankan protokol Strict Verification di atas.

---

### Step 4: Penanganan Revisi (1 Revisi = 1 Commit)
1. Jika developer memberikan catatan revisi pada saat tahap review:
   a. Kerjakan setiap item revisi secara spesifik pada core project.
   b. Lakukan **1 kali atomic commit** per poin revisi yang selesai di dalam folder core project (`Cwd: <core-project-folder>`).
   c. Perbarui file task di `@tasks/review/`.
   d. Minta konfirmasi ulang secara spesifik untuk item revisi yang baru saja diselesaikan.

---

### Step 5: Persetujuan Developer & Archiving
1. Setelah **100% poin checklist dan revisi TERJAWAB & TERKONFIRMASI**:
   a. Agent menanyakan persetujuan akhir pengarsipan:
      > *"Seluruh poin checklist pada task `{task_filename}` telah terjawab dan terverifikasi aman. Apakah disetujui untuk dipindahkan ke folder `tasks/archive/` dengan status Completed?"*
   b. Menunggu persetujuan eksplisit dari developer.
   c. Setelah disetujui, ubah status menjadi `Status: Completed`, catat tanggal penyelesaian `Completed: YYYY-MM-DD`, dan pindahkan file task dari `@tasks/review/` ke `@tasks/archive/`.