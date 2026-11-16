---
description: "Workflow standar pasca-rilis untuk mengaktifkan task dari backlog, membuat branch git terisolasi (feature/fix/chore), mengeksekusi checklist dengan atomic commit, memverifikasi secara ketat (Strict Gatekeeper), dan mengarsipkan/merge setelah persetujuan developer."
---

# Workflow: Run Task (Branch-Isolated Execution & Strict Gatekeeper)

Workflow ini dipanggil dengan instruksi `/run-task` (atau `/activate-task`) disertai mention file task backlog di `@tasks/backlog/` (misal: `/run-task @tasks/backlog/014-20261116-cross-file-heuristic-footnote-popover.md`).

---

## Steps Execution

### Step 1: Validasi, Pembuatan Feature Branch, & Aktivasi Task
1. **Validasi File Task**: Agent memeriksa keberadaan dan format file backlog yang di-mention di `@tasks/backlog/`.
2. **Pemeriksaan Status Git**:
   - Pastikan working tree git bersih (`git status`). Jika ada perubahan tak terduga, tanyakan/selesaikan terlebih dahulu.
   - Pindah ke branch produksi dan sinkronkan:
     ```bash
     git checkout main
     git pull origin main
     ```
3. **Pembuatan Branch Terisolasi**:
   - Tentukan tipe dan nama branch berdasarkan cakupan task:
     - Fitur Baru: `feature/{NNN}-{short-title}` (misal: `feature/014-cross-file-heuristic-footnote-popover`)
     - Perbaikan Bug: `fix/{NNN}-{short-title}`
     - Maintenance/Refactor: `chore/{NNN}-{short-title}`
   - Buat dan checkout ke branch baru:
     ```bash
     git checkout -b <branch-name>
     ```
4. **Aktivasi Dokumen Task**:
   - Pindahkan file task dari `@tasks/backlog/` ke `@tasks/active/`.
   - Perbarui metadata header pada file task:
     - `Status: Active`
     - `Branch: <branch-name>`
5. **Laporan Awal**: Laporkan kepada developer bahwa branch baru telah aktif dan eksekusi checklist dimulai.

---

### Step 2: Eksekusi Poin Checklist & Atomic Commit (1 Poin = 1 Commit)
> [!IMPORTANT]
> **Git Execution Scope (Mode 1: Root Git Repo)**:
> Operasi git (`git status`, `git add`, `git commit`) dijalankan langsung di branch fitur aktif. File `/tasks/`, `/resource/notes/`, dan `/resource/pr-notes/` otomatis diproteksi oleh `.gitignore`.

1. Agent membaca daftar checklist dalam file task di `@tasks/active/`.
2. Untuk **setiap 1 poin checklist** yang dikerjakan:
   a. Lakukan pengodean / penyesuaian secara presisi (*surgical changes*) pada codebase.
   b. Jalankan verifikasi otomatis terkait (misal: `npm run check`, `npm run build`, atau unit test).
   c. Lakukan **1 kali atomic commit** di branch fitur menggunakan konvensi:
      ```bash
      git commit -m "<type>(<scope>): <deskripsi ringkas poin>"
      ```
   d. Perbarui centang di file task aktif menjadi `- [x]` dan catat hash commit di sebelahnya: `*(commit: abc1234)*`.

---

### Step 3: Pengajuan ke Review Phase & Strict Verification Gatekeeper
> [!CAUTION]
> **Aturan Strict Verification (AI Gatekeeper)**:
> Developer sering kali fokus menguji secara visual di browser/webview dan hanya membahas hasilnya di chat tanpa mengisi file checklist secara manual. 
> **Agent WAJIB BERTINDAK SEBAGAI VERIFIER KETAT**:
> 1. Agent **DILARANG** menganggap task selesai atau langsung mengarsipkannya sebelum SELURUH poin checklist dijawab/dikonfirmasi secara eksplisit oleh developer.
> 2. Poin sistem/kode (build, lint, console error) diverifikasi sendiri oleh Agent dengan bukti output perintah.
> 3. Poin visual/interaksi/feeling **WAJIB DITANYAKAN SATU PER SATU ATAU DALAM DAFTAR NOMOR** kepada developer:
>    > *"Berikut poin verifikasi untuk task ini. Mohon konfirmasi apakah semuanya sudah sesuai di layarmu:*
>    > 1. *[Poin A]: Apakah ... sudah berfungsi normal?*
>    > 2. *[Poin B]: Apakah tampilan ... sudah rapi tanpa kendala?*
>    > 3. *[Poin C]: Apakah ...?"*
> 4. Jika developer hanya merespons sebagian atau mengalihkan topik ke hal lain, Agent **WAJIB MENAGIH** poin yang belum terjawab:
>    > *"Poin 1 sudah terkonfirmasi aman. Namun poin 2 dan 3 belum kamu jawab. Apakah poin 2 dan 3 sudah berjalan sesuai ekspektasi di layarmu?"*
> 5. Setelah developer mengonfirmasi ("ya", "aman", "oke"), Agent yang memperbarui centang `- [x]` di dalam file task di `@tasks/review/`.

1. Pindahkan file task dari `@tasks/active/` ke `@tasks/review/` dengan header `Status: Review`.
2. Jalankan protokol Strict Verification di atas.

---

### Step 4: Penanganan Revisi (1 Revisi = 1 Commit)
1. Jika developer memberikan catatan revisi pada saat tahap review:
   a. Kerjakan setiap item revisi secara spesifik pada codebase di branch fitur aktif.
   b. Lakukan **1 kali atomic commit** per poin revisi yang selesai:
      ```bash
      git commit -m "fix(<scope>): <deskripsi revisi>"
      ```
   c. Perbarui file task di `@tasks/review/` pada bagian *Revision Log*.
   d. Minta konfirmasi ulang secara spesifik untuk item revisi yang baru saja diselesaikan.

---

### Step 5: Persetujuan Developer, Integrasi Branch, & Archiving
1. Setelah **100% poin checklist dan revisi TERJAWAB & TERKONFIRMASI**:
   a. Agent menanyakan persetujuan akhir pengarsipan dan metode integrasi branch:
      > *"Seluruh poin checklist pada task `{task_filename}` telah terjawab dan terverifikasi aman di branch `{branch-name}`.*
      > *Apakah disetujui untuk di-merge ke `main` dan diarsipkan ke `tasks/archive/`?"*
   b. Menunggu persetujuan eksplisit dari developer.
   c. **Integrasi ke Main**:
      - Jika menggunakan alur merge lokal:
        ```bash
        git checkout main
        git merge <branch-name> # atau git merge --squash <branch-name>
        git push origin main
        git branch -d <branch-name> # hapus branch lokal yang sudah di-merge
        ```
      - Atau jika menggunakan alur PR GitHub, delegasikan ke workflow `/run-pr`.
   d. Ubah status task menjadi `Status: Completed`, catat tanggal penyelesaian `Completed: YYYY-MM-DD`, dan pindahkan file task dari `@tasks/review/` ke `@tasks/archive/`.
