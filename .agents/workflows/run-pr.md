---
description: "Workflow terintegrasi untuk menyusun PR Note, membuka Pull Request di GitHub, mengeksekusi auto-merge (squash), dan menyinkronkan cabang main & dev/feature."
---

# Run PR Workflow (Agent SOP)

Workflow ini digunakan oleh Agent Antigravity ketika developer memanggil **/run-pr** (atau ketika batch pengerjaan / task milestone selesai ditinjau dan siap disatukan ke cabang `main`).

Workflow ini mencakup proses terpadu mulai dari penyusunan dokumen catatan PR di `resource/pr-notes/`, push cabang kerja (`dev` atau `feature/*`), pembuatan Pull Request via GitHub MCP Server, eksekusi **Auto-Merge (Squash & Merge)**, hingga sinkronisasi cabang lokal dan pengarsipan task.

---

## 🎯 Kit Fundamental Acuan
- **Git Scope (Mode-Aware)**: Langsung di root workspace (`.`) untuk Mode 1 (Native), atau di dalam `{APP_FOLDER}/` (`git -C {APP_FOLDER}`) untuk Mode 2 (Guest).
- **GitHub Target**: `owner: {OWNER}` · `repo: {REPO}`
- **Pusat Catatan PR**: `resource/pr-notes/`
- **Template Catatan PR**: `resource/templates/pr-note-template.md`
- **Konvensi Branch**: Base `main`, Head `dev` atau `feature/{task-number}-{description}`
- **GitHub MCP Server Tools**: `create_pull_request` & `merge_pull_request`

---

## 📋 Langkah-langkah Operasional (Step-by-Step SOP)

### Langkah 1: Deteksi Konteks, Branch & Standar Penamaan Judul

1. **Deteksi Cabang Aktif**:
   Jalankan pemeriksaan cabang aktif pada repo git aktif:
   ```powershell
   git branch --show-current
   # (atau `git -C {APP_FOLDER} branch --show-current` jika Mode 2)
   ```
   - Jika cabang aktif adalah `dev` atau `feature/*`, gunakan sebagai `head`, dengan `base: main`.
   - Jika saat ini berada di `main`, Agent wajib menanyakan apakah developer ingin membuat branch baru terlebih dahulu atau langsung merangkum PR Note.

2. **Tentukan Format Judul PR**:
   Format judul wajib mengikuti konvensi Semantic Commit:
   - Feature baru: `feat(<scope>): <deskripsi singkat>`
   - Bug fix: `fix(<scope>): <deskripsi singkat>`
   - Polish / styling: `style(<scope>): <deskripsi singkat>`
   - Performance / refactor: `perf(<scope>): ...` atau `refactor(<scope>): ...`

3. **Nama Berkas PR Note**:
   `resource/pr-notes/pr-note-{YYYY-MM-DD}.md` (atau `pr-note-{task-number}-{topik}.md`).

---

### Langkah 2: Penyusunan Dokumen PR Note (`resource/pr-notes/`)

1. **Kumpulkan Log Commit**:
   Jalankan inspeksi commit di cabang head yang belum ada di `main`:
   ```powershell
   git log origin/main..HEAD --oneline
   ```
   *(Jika cabang lokal belum pernah dibandingkan dengan remote, gunakan `git log -n 10 --oneline` sebagai acuan)*.

2. **Susun Berkas PR Note**:
   Gunakan struktur template di `resource/templates/pr-note-template.md`. Pastikan dokumen memuat:
   - **Judul PR** resmi.
   - **Ringkasan Perubahan Utama** (Executive summary 1-2 paragraf).
   - **Fitur Baru & Pembaruan** per komponen/modul.
   - **Perbaikan Bug & Optimasi**.
   - **Maintenance & Dokumentasi**.
   - **Catatan Dev / Verifikasi**.

3. Simpan berkas catatan di `resource/pr-notes/`.

---

### Langkah 3: Push Cabang Kerja ke GitHub

1. **Pastikan Working Tree Bersih**:
   ```powershell
   git status
   ```
2. **Push Perubahan ke Remote Origin**:
   ```powershell
   git push origin <current-branch>
   ```

---

### Langkah 4: Pembuatan Pull Request Otomatis (GitHub MCP Server)

Panggil tool **`create_pull_request`** dari `github-mcp-server`:
- **`owner`**: `{OWNER}` (sesuaikan dengan remote origin)
- **`repo`**: `{REPO}` (sesuaikan dengan remote origin)
- **`title`**: Judul PR resmi dari Langkah 1
- **`head`**: Cabang kerja aktif (`dev` atau `feature/*`)
- **`base`**: `main`
- **`body`**: Isi lengkap dari dokumen PR Note yang disusun pada Langkah 2

Catat nomor Pull Request yang berhasil dibuat (misal: `#12`) dan URL PR tersebut.

---

### Langkah 5: Eksekusi Auto-Merge di GitHub (Metode Squash)

Sesuai filosofi proyek *"Satu PR = Satu Tonggak Utuh"*, lakukan merge PR menggunakan metode **Squash and Merge**:

Panggil tool **`merge_pull_request`** dari `github-mcp-server`:
- **`owner`**: `{OWNER}`
- **`repo`**: `{REPO}`
- **`pull_number`**: Nomor PR dari Langkah 4
- **`merge_method`**: `squash`
- **`commit_title`**: `{PR_Title} (#{pull_number})`

---

### Langkah 6: Sinkronisasi Cabang Lokal & Update Task

Setelah merge berhasil di sisi server GitHub:
1. **Tarik Pembaruan ke Cabang `main` Lokal**:
   ```powershell
   git checkout main
   git pull origin main
   ```
2. **Sinkronkan / Rapikan Cabang Kerja Lokal**:
   - Jika menggunakan `dev`:
     ```powershell
     git checkout dev
     git reset --hard main
     git push origin dev --force-with-lease
     ```
   - Jika menggunakan branch feature (`feature/*`), cabang feature lokal dapat dihapus setelah merge:
     ```powershell
     git branch -d <feature-branch>
     ```
3. **Pembaruan Task & Backlog**:
   - Pindahkan task terkait dari `tasks/review/` ke `tasks/archive/` dengan status `Completed`.
   - Laporkan ringkasan URL PR yang telah dimerge kepada developer.

---
*Created by Antigravity AI*
