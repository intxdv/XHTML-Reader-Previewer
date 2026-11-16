---
name: run-release
description: "Workflow terintegrasi untuk release versioning: pre-flight check, bump version package.json, generate release notes, atomic commit, git tag v*, push ke remote, dan memicu GitHub Actions automated release."
---

# Skill: Run Release (Version Bump, Tag & GitHub Release)

Skill ini dipanggil dengan slash command `/run-release` ketika serangkaian fitur, perbaikan bug, atau milestone telah di-merge ke cabang `main` dan siap dirilis ke publik sebagai versi baru (`vX.Y.Z`).

Workflow ini mengorkestrasi seluruh tahapan rilis secara otomatis dan terstandarisasi: verifikasi pre-flight ketat, kalkulasi SemVer, penyusunan Release Notes resmi di `resource/release/`, bump versi di `package.json`, pembuatan annotated git tag, push ke GitHub, hingga verifikasi terbitnya rilis otomatis melalui GitHub Actions (`.github/workflows/release.yml`).

---

## 🎯 Kit Fundamental Acuan
- **Target Branch**: Wajib berada di cabang `main`.
- **Target Repo**: `owner: intxdv` · `repo: XHTML-Reader-Previewer`
- **Pusat Release Notes**: `resource/release/RELEASE_NOTES_v{X.Y.Z}.md`
- **Template Release Notes**: `resource/templates/release-note-template.md`
- **CI/CD Automasi**: `.github/workflows/release.yml` (terpicu otomatis saat tag `v*` di-push)
- **GitHub MCP Server Tools**: `list_releases`, `get_latest_release`, `get_release_by_tag`

---

## 📋 Langkah-langkah Operasional (Step-by-Step SOP)

### Langkah 1: Pre-Flight Verification & Strict Gatekeeper
Sebelum melakukan rilis, pastikan integritas repositori 100% aman:
1. **Verifikasi Cabang & Status Git**:
   ```powershell
   git checkout main
   git pull origin main
   git status --porcelain
   ```
   *Working tree WAJIB bersih (tidak ada uncommitted changes).*
2. **Jalankan Static Analysis & Test Suite**:
   ```powershell
   npm run check
   npm test
   ```
   *Semua pengecekan tipe TypeScript dan seluruh unit test WAJIB lulus (0 errors, 0 fails).*

---

### Langkah 2: Penentuan Versi Baru (Semantic Versioning)
1. **Deteksi Versi Saat Ini**:
   Periksa field `"version"` pada `package.json` dan tag git terakhir:
   ```powershell
   git describe --tags --abbrev=0
   ```
2. **Kalkulasi Bump Berdasarkan Cakupan Perubahan**:
   - **Patch** (`0.0.X` -> `0.0.(X+1)`): Perbaikan bug minor, layout styling fixes, atau visual polish kecil.
   - **Minor** (`0.X.0` -> `0.(X+1).0`): Fitur baru yang substansial, peningkatan modul besar, atau penambahan fungsionalitas baru yang tetap backwards-compatible (misal: multi-column paginated reader, cross-file footnotes, history stack, spine inspector).
   - **Major** (`X.0.0` -> `(X+1).0.0`): Perubahan arsitektur besar atau perombakan format yang mematahkan kompatibilitas versi sebelumnya.
3. Konfirmasikan target versi dengan developer jika belum didefinisikan secara eksplisit di prompt.

---

### Langkah 3: Penyusunan Release Notes Resmi
1. **Kumpulkan Riwayat Commit & PR Notes**:
   ```powershell
   git log <latest_tag>..HEAD --oneline
   ```
   Periksa berkas PR note terkait di `resource/pr-notes/` untuk menyerap deskripsi fitur dan detail teknis.
2. **Susun Berkas Release Notes**:
   Gunakan struktur dari template `resource/templates/release-note-template.md`.
   Simpan di:
   `resource/release/RELEASE_NOTES_v{X.Y.Z}.md`
   Dokumen memuat:
   - Judul & ringkasan rilis.
   - **What's New**: Rincian fitur baru utama.
   - **Improvements & Polish**: Peningkatan visual, navigasi, performa, dan tema.
   - **Bug Fixes**: Perbaikan bug yang diselesaikan.
   - **Testing & Reliability**: Cakupan test suite dan fixtures.
   - **Installation Guide & Checksum placeholder**.

---

### Langkah 4: Bump Versi & Atomic Commit
1. **Update Versi pada `package.json` dan `package-lock.json`**:
   ```powershell
   npm version {X.Y.Z} --no-git-tag-version
   ```
2. **Re-build Bundles**:
   ```powershell
   npm run build
   ```
   *Memastikan artifak `dist/` terkompilasi segar.*
3. **Lakukan Atomic Git Commit**:
   ```powershell
   git add package.json package-lock.json resource/release/RELEASE_NOTES_v{X.Y.Z}.md
   git commit -m "chore(release): bump version to v{X.Y.Z}"
   ```

---

### Langkah 5: Pembuatan Git Tag & Push ke GitHub
1. **Buat Annotated Git Tag**:
   ```powershell
   git tag -a v{X.Y.Z} -m "Release v{X.Y.Z}"
   ```
2. **Push Commit dan Tag ke Remote**:
   ```powershell
   git push origin main
   git push origin v{X.Y.Z}
   ```

---

### Langkah 6: Automasi CI/CD & Verifikasi Rilis di GitHub
1. **Pemicu Otomatis GitHub Actions**:
   Push tag `v{X.Y.Z}` secara otomatis memicu workflow `.github/workflows/release.yml`.
   GitHub Actions akan:
   - Menjalankan `npm run check` dan `npm test`.
   - Mengemas paket ekstensi VSIX (`npx @vscode/vsce package`).
   - Menghitung hash SHA-256 VSIX.
   - Menerbitkan GitHub Release dengan menyematkan berkas `.vsix` dan catatan rilis otomatis.
2. **Verifikasi Publikasi**:
   Gunakan tool `github-mcp-server`:
   - `list_releases` atau `get_latest_release` untuk memverifikasi rilis berhasil dibuat di GitHub.
3. **Laporan ke Developer**:
   Sajikan ringkasan rilis, tag yang dipublikasikan, dan link ke GitHub Release resmi.
