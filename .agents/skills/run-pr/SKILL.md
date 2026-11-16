---
name: run-pr
description: "Workflow terintegrasi untuk menyusun PR Note, membuka Pull Request di GitHub, mengeksekusi auto-merge (squash), dan menyinkronkan cabang main & feature."
---

# Skill: Run PR (Pull Request & Auto-Merge)

Skill ini dipanggil dengan slash command `/run-pr` ketika pengerjaan task / batch perubahan pada branch fitur (`feature/*`, `fix/*`, `chore/*`) selesai ditinjau dan siap disatukan ke cabang `main`.

Workflow ini mencakup proses terpadu mulai dari penyusunan dokumen catatan PR di `resource/pr-notes/`, push branch kerja, pembuatan Pull Request via GitHub MCP Server, eksekusi **Auto-Merge (Squash & Merge)**, hingga sinkronisasi cabang lokal dan pengarsipan task.

---

## 🎯 Kit Fundamental Acuan
- **Git Scope**: Langsung di root workspace (`.`)
- **GitHub Target**: `owner: intxdv` · `repo: XHTML-Reader-Previewer`
- **Pusat Catatan PR**: `resource/pr-notes/`
- **Template Catatan PR**: `resource/templates/pr-note-template.md`
- **Konvensi Branch**: Base `main`, Head `feature/*`, `fix/*`, atau `chore/*`
- **GitHub MCP Server Tools**: `create_pull_request` & `merge_pull_request`

---

## 📋 Langkah-langkah Operasional (Step-by-Step SOP)

### Langkah 1: Deteksi Konteks, Branch & Standar Penamaan Judul
1. **Deteksi Cabang Aktif**:
   ```powershell
   git branch --show-current
   ```
   Pastikan berada di cabang kerja (`feature/*`, `fix/*`, `chore/*`), dengan target `base: main`.
2. **Tentukan Format Judul PR**:
   - Feature baru: `feat(<scope>): <deskripsi singkat>`
   - Bug fix: `fix(<scope>): <deskripsi singkat>`
   - Maintenance: `chore(<scope>): <deskripsi singkat>`
3. **Nama Berkas PR Note**:
   `resource/pr-notes/pr-note-{NNN}-{short-title}.md` (atau `pr-note-{YYYY-MM-DD}.md`).

---

### Langkah 2: Penyusunan Dokumen PR Note (`resource/pr-notes/`)
1. **Kumpulkan Log Commit**:
   ```powershell
   git log origin/main..HEAD --oneline
   ```
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
   git push -u origin <current-branch>
   ```

---

### Langkah 4: Pembuatan Pull Request Otomatis (GitHub MCP Server)
Panggil tool **`create_pull_request`** dari `github-mcp-server`:
- **`owner`**: `intxdv`
- **`repo`**: `XHTML-Reader-Previewer`
- **`title`**: Judul PR resmi dari Langkah 1
- **`head`**: Cabang kerja aktif
- **`base`**: `main`
- **`body`**: Isi lengkap dari dokumen PR Note yang disusun pada Langkah 2

Catat nomor Pull Request yang berhasil dibuat (misal: `#14`) dan URL PR tersebut.

---

### Langkah 5: Eksekusi Auto-Merge di GitHub (Metode Squash)
Sesuai filosofi proyek *"Satu Task = Satu Squash Commit di Main"*, lakukan merge PR menggunakan metode **Squash and Merge**:

Panggil tool **`merge_pull_request`** dari `github-mcp-server`:
- **`owner`**: `intxdv`
- **`repo`**: `XHTML-Reader-Previewer`
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
2. **Rapikan Cabang Kerja Lokal**:
   ```powershell
   git branch -d <branch-name>
   ```
3. **Pembaruan Task & Backlog**:
   - Pindahkan task terkait dari `tasks/review/` ke `tasks/archive/` dengan status `Status: Completed`.
   - Laporkan ringkasan URL PR yang telah dimerge kepada developer.
