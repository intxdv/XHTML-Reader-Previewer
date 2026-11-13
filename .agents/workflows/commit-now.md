---
description: "Workflow untuk melakukan atomic git commit langsung untuk perubahan ad-hoc di luar task aktif pada repo aktif."
---

# Workflow: Commit Now

Gunakan workflow ini saat developer meminta commit langsung (`/commit-now` atau "commit perubahan ini").

> [!IMPORTANT]
> **Git Execution Scope (Mode-Aware)**:
> - **Mode 1 (Native / Root Git Repo)**: Jika root workspace memiliki direktori `.git`, seluruh perintah git dieksekusi langsung di root workspace (`git status`, `git commit -m ...`).
> - **Mode 2 (Guest / Subfolder Repo)**: Jika root BUKAN git repo, seluruh perintah git WAJIB dieksekusi di dalam folder core project (`Cwd: <core-project-folder>` atau `git -C <core-project-folder>`).

---

## Steps Execution
1. **Deteksi Git Target**:
   Periksa apakah root workspace adalah repositori Git (`Test-Path .git`).
   - Jika YA (Mode 1): Target git adalah root (`.`).
   - Jika TIDAK (Mode 2): Target git adalah subfolder core project (`<core-project-folder>`).

2. **Evaluasi Perubahan**:
   Jalankan pemeriksaan status dan diff pada target git:
   ```bash
   git status
   git diff
   ```
3. Pastikan perubahan terisolasi, logis, dan bersih dari debug artifacts atau file yang tidak sengaja ter-stage.
4. Buat commit message dengan format Conventional Commit:
   ```bash
   git commit -m "<type>(<scope>): <deskripsi ringkas>"
   ```
   *(atau `git -C <core-project-folder> commit -m "..."` pada Mode 2)*.
5. Laporkan commit hash dan ringkasan perubahan kepada developer.
